/**
 * 文書が更新されたときにPDFのアノテーションを追跡する
 *
 * 新旧PDFのページ画像をLightGlue-ONNX（SuperPoint+LightGlue統合モデル）で特徴点マッチングし、
 * 推定した相似変換（拡大縮小・回転・平行移動）でアノテーション座標を新文書上の位置へ補正する。
 * ページ数が変化している場合はテキスト類似度による対応付け（`pageCorrespondence`）を先に行う。
 * モデル未配置時は追跡処理自体を行わず座標を維持する。個別のページで推論・変換推定に
 * 失敗した場合は座標を維持したうえで`tags`に`LOW_CONFIDENCE_TAG`を追加し、
 * 呼び出し側（UI）でユーザーに確認を促せるようにする
 *
 * ページ数が多い文書では全体の処理に数十秒〜分単位の時間がかかり得るため、`onProgress`で
 * 進捗（完了ページ数/総ページ数）を呼び出し側へ通知できるようにしている。また、各ページの
 * 処理後に明示的にマクロタスク境界へ処理を戻す（`setTimeout(0)`）ことで、メインスレッドが
 * ポインタ入力やUI描画を処理できる猶予を確保している
 */

import type { DocumentSource } from 'src/models/document/common';
import type { AnnotationStyle } from 'src/models/document/pdf';
import { Success, type Result } from 'src/models/error/result';
import { getNumPages, renderPageToCanvas } from 'src/repositories/document/pdf';
import { runConcurrently } from 'src/utils/promise/concurrent';
import { buildPageCorrespondence } from './pageCorrespondence';
import { matchPageImages } from './pageRegistration';
import { estimateSimilarityRansac } from './similarityTransform';
import { transformAnnotationStyle } from './applyAnnotationTransform';
import { getLightGlueSession } from './lightglueSession';

/** 自動追跡ができなかった、または精度が低いことを示すタグ（既存の`AnnotationStyle.tags`を利用） */
export const LOW_CONFIDENCE_TAG = 'tracker:low-confidence';

/** ページ画像レンダリングのスケール（大きいほど特徴点マッチングの精度は上がるが処理負荷も増える） */
const RENDER_SCALE = 1.5;
/** 同時に処理するページ対の数。ページのCanvas/テンソルを全ページ分同時に保持しないための上限（メモリ仮想化） */
const PAGE_CONCURRENCY = 2;

function withLowConfidenceTag(style: AnnotationStyle): AnnotationStyle {
  const tags = style.tags ?? [];
  if (tags.includes(LOW_CONFIDENCE_TAG)) return style;
  return { ...style, tags: [...tags, LOW_CONFIDENCE_TAG] };
}

function withoutLowConfidenceTag(style: AnnotationStyle): AnnotationStyle {
  if (!style.tags?.includes(LOW_CONFIDENCE_TAG)) return style;
  return { ...style, tags: style.tags.filter((tag) => tag !== LOW_CONFIDENCE_TAG) };
}

/** 追跡処理の進捗（ページ単位）。`total`は追跡対象ページ数の確定時点で通知する */
export interface TrackingProgress {
  completed: number;
  total: number;
}

/** マクロタスク境界へ処理を戻し、メインスレッドにポインタ入力・描画処理の機会を与える */
function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 旧文書のアノテーションを新文書における位置で上書きして返す
 */
export async function trackPdfAnnotation(
  oldSrc: DocumentSource,
  newSrc: DocumentSource,
  annotStyles: AnnotationStyle[],
  onProgress?: (progress: TrackingProgress) => void,
): Promise<Result<AnnotationStyle[]>> {
  if (annotStyles.length === 0) return Success(annotStyles);

  // モデル未配置・ロード失敗時は追跡処理自体を行わず、座標をそのまま維持する
  const sessionRes = await getLightGlueSession();
  if (!sessionRes.ok) return Success(annotStyles);

  const [oldNumPagesRes, newNumPagesRes] = await Promise.all([
    getNumPages(oldSrc),
    getNumPages(newSrc),
  ]);
  if (!oldNumPagesRes.ok || !newNumPagesRes.ok) {
    return Success(annotStyles.map(withLowConfidenceTag));
  }

  const byOldPage = new Map<number, AnnotationStyle[]>();
  for (const style of annotStyles) {
    const list = byOldPage.get(style.pageNumber) ?? [];
    list.push(style);
    byOldPage.set(style.pageNumber, list);
  }

  const correspondence = await buildPageCorrespondence(
    oldSrc,
    newSrc,
    Array.from(byOldPage.keys()),
    oldNumPagesRes.value,
    newNumPagesRes.value,
  );

  const pageEntries = Array.from(byOldPage.entries());
  const total = pageEntries.length;
  let completed = 0;
  onProgress?.({ completed, total });

  async function trackPage(oldPageNum: number, styles: AnnotationStyle[]) {
    const newPageNum = correspondence.get(oldPageNum);
    if (newPageNum === undefined) {
      // 対応する新ページが見つからない（ページ削除等）ため座標を維持し低信頼とする
      return styles.map(withLowConfidenceTag);
    }

    const [oldCanvasRes, newCanvasRes] = await Promise.all([
      renderPageToCanvas(oldSrc, oldPageNum, RENDER_SCALE),
      renderPageToCanvas(newSrc, newPageNum, RENDER_SCALE),
    ]);
    if (!oldCanvasRes.ok || !newCanvasRes.ok) {
      return styles.map(withLowConfidenceTag);
    }

    const matchRes = await matchPageImages(oldCanvasRes.value, newCanvasRes.value);
    if (!matchRes.ok) {
      return styles.map(withLowConfidenceTag);
    }

    const estimate = estimateSimilarityRansac(matchRes.value.oldPoints, matchRes.value.newPoints);
    if (!estimate) {
      return styles.map(withLowConfidenceTag);
    }

    return styles.map((style) => {
      const moved = transformAnnotationStyle(
        { ...style, pageNumber: newPageNum },
        estimate.transform,
      );
      return withoutLowConfidenceTag(moved);
    });
  }

  const tasks = pageEntries.map(
    ([oldPageNum, styles]) =>
      async (): Promise<AnnotationStyle[]> => {
        const result = await trackPage(oldPageNum, styles);

        completed += 1;
        onProgress?.({ completed, total });
        await yieldToMainThread();

        return result;
      },
  );

  const results = await runConcurrently(tasks, PAGE_CONCURRENCY);
  return Success(results.flat());
}
