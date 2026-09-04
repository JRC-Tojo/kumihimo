/**
 * PDF エディタサービス
 * アノテーション管理とPDF操作の統合サービス
 */

import * as pdfjsLib from 'pdfjs-dist';
import type { ContainerElementFile } from 'src/models/container';
import type { DocumentSource } from 'src/models/document/common';
import type { TextItemBox } from 'src/models/document/pdf';
import type { TextSearchMatch } from 'src/models/document/search';
import {
  acquirePdfDocument,
  type AcquiredPdfDocument,
} from 'src/repositories/document/pdfDocumentCache';
import {
  extractTextBlocksByPageFromDoc,
  searchTextInDoc,
  type SearchTextInDocOptions,
} from 'src/repositories/document/pdf';
import {
  getCachedRender,
  renderCacheKey,
  setCachedRender,
} from 'src/repositories/document/renderCache';
import type { TileDescriptor } from 'src/components/Viewer/tiling';

export type PdfDocument = pdfjsLib.PDFDocumentProxy;
export type { AcquiredPdfDocument };

/** CSS px（devicePixelRatio適用前）でのページ寸法 */
export interface PageSize {
  width: number;
  height: number;
}

/**
 * PDF.jsワーカーを初期化
 */
function initWorker() {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url,
  ).toString();
}

/**
 * PDFファイルを読み込む（ファイル単位でキャッシュされたPDFDocumentProxyを取得する）
 *
 * 同一ファイルへ複数箇所（ビューア表示・OCR用のテキスト/画像抽出）からアクセスしても
 * PDF全体の再読込・pdf.jsのWorker生成が重複しないよう、`pdfDocumentCache`を介して取得する。
 * 取得したら、使い終わり次第（タブを閉じる等）必ず戻り値の`release()`を呼ぶこと
 */
export async function acquirePdf(
  file: ContainerElementFile,
  docSrc: DocumentSource,
): Promise<AcquiredPdfDocument> {
  const res = await acquirePdfDocument(file, docSrc);
  if (!res.ok) throw new Error(`PDF読み込みエラー: ${res.error.message}`);
  return res.value;
}

// 同一canvas要素に対して発行した直近のrenderPage()呼び出し世代を追跡する。
// ズームのデバウンス再描画とページ切り替えの再描画などが同じcanvasに対して重なって呼ばれると、
// 先に開始した（古い）呼び出しのpage.render()が、後から開始した（新しい）呼び出しより
// 遅れて完了することがある。世代チェック無しで無条件にcanvasへ転写すると、後から完了した
// 古い呼び出しが新しい表示を古い画像で上書きしてしまうため、実際にcanvasへ転写する直前に
// 「自分がそのcanvasに対する最新の呼び出しか」を確認し、古い世代の結果は反映しないようにする
const canvasRenderGeneration = new WeakMap<HTMLCanvasElement, number>();

/** 実際にcanvasへリサイズ・転写を行う（新旧どちらの経路でも同一の反映手順を共有する） */
function commitToCanvas(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  pixelWidth: number,
  pixelHeight: number,
  cssWidth: number,
  cssHeight: number,
): void {
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas context not available');
  }
  context.drawImage(source, 0, 0);
}

// 同一canvas要素に対する直近のRenderTask（pdf.jsの`page.render()`が返す進行中のレンダリングタスク）。
// 世代チェックだけでは、古い呼び出しの結果をcanvasへ反映しないようにはできても、pdf.js内部の
// RenderTask自体はキャンセルされずに最後まで実行され続けてしまい、CPU・メモリを無駄に消費する
// （頻繁なズーム操作・高速なページ切り替え時に顕著。巨大ページのレンダリング失敗の一因にもなり得る）。
// 新しい呼び出しが来た時点で、同じcanvasに対する前のRenderTaskを`.cancel()`することでこれを防ぐ
const canvasRenderTask = new WeakMap<HTMLCanvasElement, pdfjsLib.RenderTask>();

/**
 * `renderPage()`が投げるエラーが、レンダリングタスクの意図的なキャンセル
 * （`canvasRenderTask`による前タスクの`.cancel()`、またはページ・ズーム切り替え時の重複呼び出し）に
 * よるものかどうかを判定する。呼び出し側はこの場合、実際の失敗ではないためユーザーへの通知を抑制できる
 */
export function isRenderCancelledError(error: unknown): boolean {
  return error instanceof Error && error.name === 'RenderingCancelledException';
}

/**
 * 指定canvasに対する進行中のレンダリング（`renderPage()`/`renderPageTile()`が発行した`RenderTask`）を
 * キャンセルする。連続表示モードの仮想化（`DocumentViewer.vue`のページvirtualization）では、
 * ページがビューポートへ一瞬入っただけで`PdfPage.vue`がマウントされ即座にレンダリングが
 * 走り出すため、高速スクロール中はもう表示されないページ・タイルの描画がキャンセルされずに残り続け、
 * 同一PDFファイルで共有される単一のpdf.js Worker（`pdfDocumentCache.ts`）を専有してしまう。
 * `PdfPage.vue`が破棄される時点でこれを呼び、不要な描画がWorkerキューに残らないようにする
 */
export function cancelPendingRenderForCanvas(canvas: HTMLCanvasElement): void {
  canvasRenderTask.get(canvas)?.cancel();
}

/**
 * ページをCanvasにレンダリングする。戻り値はCSS px（devicePixelRatio適用前）でのページ寸法で、
 * レイアウト計算（連続表示モードのページサイズ確保等）に利用する
 *
 * `fileKeyForCache`（`src/utils/document/fileKey.ts`の`fileKey()`）を渡すと、`renderCache.ts`に
 * ファイル・ページ・倍率単位でレンダリング結果をキャッシュし、再訪問時はpdf.js側の呼び出し自体を
 * スキップする。`generateThumbnail`（`maxWidth`指定あり）はページごとに解像度が異なりキャッシュの
 * 恩恵が薄いため、意図的にこの引数を渡さず対象から除外している
 */
export async function renderPage(
  pdfDocument: PdfDocument,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number = 1,
  maxWidth: number = 0,
  fileKeyForCache?: string,
): Promise<PageSize> {
  const generation = (canvasRenderGeneration.get(canvas) ?? 0) + 1;
  canvasRenderGeneration.set(canvas, generation);

  const dpr = window.devicePixelRatio || 1;
  const cacheKey =
    fileKeyForCache !== undefined && maxWidth === 0
      ? renderCacheKey({ fileKey: fileKeyForCache, pageNumber, scale, devicePixelRatio: dpr })
      : undefined;

  // 同じcanvasに対して前の呼び出しのRenderTaskがまだ進行中なら、ここでキャンセルする
  canvasRenderTask.get(canvas)?.cancel();

  try {
    if (cacheKey !== undefined) {
      const cached = getCachedRender(cacheKey);
      if (cached) {
        const width = cached.width / dpr;
        const height = cached.height / dpr;
        if (canvasRenderGeneration.get(canvas) === generation) {
          commitToCanvas(canvas, cached, cached.width, cached.height, width, height);
        }
        return { width, height };
      }
    }

    const page = await pdfDocument.getPage(pageNumber);

    // getPage()の待機中により新しい呼び出しが発行されていた場合、ここでpage.render()を
    // 開始してしまうと古い描画タスクがcanvasRenderTaskを上書きし、新しいタスクを
    // キャンセルできなくなる（CPU・メモリを最後まで消費し続ける）ため、ここで打ち切る
    if (canvasRenderGeneration.get(canvas) !== generation) {
      throw Object.assign(new Error('Rendering cancelled: superseded by a newer render call'), {
        name: 'RenderingCancelledException',
      });
    }

    let viewport = page.getViewport({ scale });
    if (maxWidth !== 0) {
      viewport = page.getViewport({ scale: maxWidth / viewport.width });
    }

    // 高解像度ディスプレイ（Retina等）対応
    const pixelWidth = viewport.width * dpr;
    const pixelHeight = viewport.height * dpr;

    // 画面に表示中のcanvasへ直接`width`/`height`を設定すると、その瞬間に同期的にラスタが
    // クリアされ、非同期の`page.render()`が完了するまでの間、白紙のcanvasが一瞬見えてしまう
    // （ズームのデバウンス再描画で顕著）。オフスクリーンのcanvasへ描画を完了させてから、
    // 表示用canvasのリサイズと転写を同一の同期処理内でまとめて行うことで、表示用canvasが
    // 古い内容から新しい内容へ一度に切り替わるようにし、空白フレームが表示されないようにする
    const offscreen = document.createElement('canvas');
    offscreen.width = pixelWidth;
    offscreen.height = pixelHeight;
    const offscreenContext = offscreen.getContext('2d');
    if (!offscreenContext) {
      throw new Error('Canvas context not available');
    }
    offscreenContext.scale(dpr, dpr);

    const renderContext = {
      canvasContext: offscreenContext,
      viewport: viewport,
      canvas: offscreen,
    };
    const renderTask = page.render(renderContext);
    canvasRenderTask.set(canvas, renderTask);
    await renderTask.promise;

    // キャッシュへの登録は、以降のcanvas転写がこの呼び出しの世代であるかどうかに関わらず行う
    // （このpdf.js呼び出し自体が生成した内容はページ・倍率の組に対して常に有効なため）
    if (cacheKey !== undefined) {
      const bitmap = await createImageBitmap(offscreen);
      setCachedRender(cacheKey, bitmap);
    }

    // ここまで来て初めて表示用canvasを更新する（リサイズ→転写が同一タスク内で完結するため、
    // ブラウザが空白状態を描画する隙が生まれない）。ただし、待機中に同じcanvasへ向けた
    // より新しい呼び出しが発行されていた場合、この結果はもう古いため転写しない
    if (canvasRenderGeneration.get(canvas) === generation) {
      commitToCanvas(canvas, offscreen, pixelWidth, pixelHeight, viewport.width, viewport.height);
    }

    return { width: viewport.width, height: viewport.height };
  } catch (error) {
    // キャンセルは意図した動作のため、呼び出し側が`isRenderCancelledError`で判別できるよう
    // 汎用Errorへ包み直さずそのまま伝搬する
    if (isRenderCancelledError(error)) throw error;
    throw new Error(
      `ページレンダリングエラー: ${error instanceof Error ? error.message : 'Unknown'}`,
    );
  }
}

/**
 * ページの一部（タイル）だけをCanvasにレンダリングする。`src/components/Viewer/tiling.ts`の
 * `shouldUseTiling`が真になるような巨大ページ×高倍率の組み合わせでのみ`PdfPage.vue`から使われ、
 * 通常サイズのページ・通常倍率では一切呼ばれない（既存の`renderPage()`の単一canvas経路のみを使う）。
 *
 * `tile`はページ左上を原点とした、`scale`適用後のCSS px矩形（`tiling.ts`の`computeTiles`が返す値）。
 * pdf.jsの`page.render()`に、ページ全体分の`viewport`と「タイル左上を原点に平行移動する」追加の
 * `transform`行列を渡すことで、タイル分の小さいoffscreen canvasだけにその範囲を描画させる
 * （`canvasContext`側で`dpr`スケールを適用済みのため、`transform`自体はCSS px単位の平行移動でよい）。
 *
 * `dpr`はここで`window.devicePixelRatio`を読み直すのではなく、呼び出し側（`PdfPage.vue`）が
 * タイルグリッド計算（`computeTiles`）時に使った値をそのまま渡すこと。`tile`のCSS px寸法は
 * その時点の`dpr`を基準に`TILE_SIZE_DEVICE_PX`へ収まるよう計算されているため、描画時に異なる
 * `dpr`を使うと device px換算の寸法がその前提からずれてしまう
 */
export async function renderPageTile(
  pdfDocument: PdfDocument,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number,
  tile: TileDescriptor,
  dpr: number,
  fileKeyForCache?: string,
): Promise<void> {
  const generation = (canvasRenderGeneration.get(canvas) ?? 0) + 1;
  canvasRenderGeneration.set(canvas, generation);

  const pixelWidth = Math.round(tile.width * dpr);
  const pixelHeight = Math.round(tile.height * dpr);
  const cacheKey =
    fileKeyForCache !== undefined
      ? renderCacheKey({
          fileKey: fileKeyForCache,
          pageNumber,
          scale,
          devicePixelRatio: dpr,
          tile: { col: tile.col, row: tile.row, tileSize: pixelWidth },
        })
      : undefined;

  // 同じcanvasに対して前の呼び出しのRenderTaskがまだ進行中なら、ここでキャンセルする
  canvasRenderTask.get(canvas)?.cancel();

  try {
    if (cacheKey !== undefined) {
      const cached = getCachedRender(cacheKey);
      if (cached) {
        if (canvasRenderGeneration.get(canvas) === generation) {
          commitToCanvas(canvas, cached, cached.width, cached.height, tile.width, tile.height);
        }
        return;
      }
    }

    const page = await pdfDocument.getPage(pageNumber);

    // getPage()の待機中に新しい呼び出しが発行されていた場合、ここで打ち切る
    if (canvasRenderGeneration.get(canvas) !== generation) {
      throw Object.assign(new Error('Rendering cancelled: superseded by a newer render call'), {
        name: 'RenderingCancelledException',
      });
    }

    const viewport = page.getViewport({ scale });

    const offscreen = document.createElement('canvas');
    offscreen.width = pixelWidth;
    offscreen.height = pixelHeight;
    const offscreenContext = offscreen.getContext('2d');
    if (!offscreenContext) {
      throw new Error('Canvas context not available');
    }
    offscreenContext.scale(dpr, dpr);

    const renderTask = page.render({
      canvasContext: offscreenContext,
      viewport,
      canvas: offscreen,
      transform: [1, 0, 0, 1, -tile.x, -tile.y],
    });
    canvasRenderTask.set(canvas, renderTask);
    await renderTask.promise;

    if (cacheKey !== undefined) {
      const bitmap = await createImageBitmap(offscreen);
      setCachedRender(cacheKey, bitmap);
    }

    if (canvasRenderGeneration.get(canvas) === generation) {
      commitToCanvas(canvas, offscreen, pixelWidth, pixelHeight, tile.width, tile.height);
    }
  } catch (error) {
    // キャンセルは意図した動作のため、呼び出し側が`isRenderCancelledError`で判別できるよう
    // 汎用Errorへ包み直さずそのまま伝搬する
    if (isRenderCancelledError(error)) throw error;
    throw new Error(
      `タイルレンダリングエラー: ${error instanceof Error ? error.message : 'Unknown'}`,
    );
  }
}

export async function generateThumbnail(
  pdfDocument: PdfDocument,
  pageNumber: number,
  maxWidth: number = 120,
): Promise<string> {
  try {
    const canvas = document.createElement('canvas');
    await renderPage(pdfDocument, pageNumber, canvas, 1, maxWidth);
    return canvas.toDataURL('image/jpeg', 0.8);
  } catch (error) {
    console.error(
      `Thumbnail generation error: ${error instanceof Error ? error.message : 'Unknown'}`,
    );
    return '';
  }
}

/**
 * 全ページのサイズ（スケール1でのCSS px寸法）を取得する
 *
 * 連続表示モードでページを仮想化（画面近傍のみ実描画）する際、未描画のページ分も
 * レイアウト上の高さを確保しておく必要があるため、実際のレンダリング（重い処理）を伴わない
 * メタ情報取得（`getViewport`のみ）で全ページ分のサイズを事前に取得しておく
 */
export async function getPageViewportSizes(pdfDocument: PdfDocument): Promise<PageSize[]> {
  const sizes: PageSize[] = [];
  for (let i = 1; i <= pdfDocument.numPages; i++) {
    const page = await pdfDocument.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    sizes.push({ width: viewport.width, height: viewport.height });
  }
  return sizes;
}

/**
 * 指定ページの全テキストアイテムを、位置情報（スケール1でのバウンディングボックス）付きで取得する
 *
 * 選択可能なテキストレイヤー（`TextLayer.vue`）の描画に使う。ビューア表示中の文書は既に
 * `acquirePdf`でPDFDocumentProxyを取得済みのため、`BackendApi`を経由した再読み込みは行わず
 * ここで直接リポジトリ関数を呼ぶ（`renderPage`等、他のビューア描画関数と同じ扱い）。
 * 抽出に失敗した場合はコンソールにログを出すのみで、空配列（テキストレイヤーなし）にフォールバックする
 */
export async function getPageTextBlocks(
  pdfDocument: PdfDocument,
  pageNumber: number,
): Promise<TextItemBox[]> {
  const res = await extractTextBlocksByPageFromDoc(pdfDocument, pageNumber);
  if (!res.ok) {
    console.error(`テキストブロック抽出エラー (page=${pageNumber}): ${res.error.message}`);
    return [];
  }
  return res.value;
}

/**
 * 現在開いている文書全ページを対象に、クエリにマッチするテキストの位置一覧を取得する（Ctrl+F検索）
 *
 * `getPageTextBlocks`と同じ理由で、既に取得済みのPDFDocumentProxyをそのまま使う
 */
export async function searchDocumentText(
  pdfDocument: PdfDocument,
  query: string,
  options: SearchTextInDocOptions = {},
): Promise<TextSearchMatch[]> {
  const res = await searchTextInDoc(pdfDocument, query, options);
  if (!res.ok) {
    console.error(`文書内検索エラー: ${res.error.message}`);
    return [];
  }
  return res.value;
}

// ワーカー初期化
initWorker();
