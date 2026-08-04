/**
 * PDF エディタサービス
 * アノテーション管理とPDF操作の統合サービス
 */

import * as pdfjsLib from 'pdfjs-dist';
import type { ContainerElementFile } from 'src/models/container';
import type { DocumentSource } from 'src/models/document/common';
import {
  acquirePdfDocument,
  type AcquiredPdfDocument,
} from 'src/repositories/document/pdfDocumentCache';

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
 * ページをCanvasにレンダリングする。戻り値はCSS px（devicePixelRatio適用前）でのページ寸法で、
 * レイアウト計算（連続表示モードのページサイズ確保等）に利用する
 */
export async function renderPage(
  pdfDocument: PdfDocument,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number = 1,
  maxWidth: number = 0,
): Promise<PageSize> {
  const generation = (canvasRenderGeneration.get(canvas) ?? 0) + 1;
  canvasRenderGeneration.set(canvas, generation);

  // 同じcanvasに対して前の呼び出しのRenderTaskがまだ進行中なら、ここでキャンセルする
  canvasRenderTask.get(canvas)?.cancel();

  try {
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
    const dpr = window.devicePixelRatio || 1;
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

    // ここまで来て初めて表示用canvasを更新する（リサイズ→転写が同一タスク内で完結するため、
    // ブラウザが空白状態を描画する隙が生まれない）。ただし、待機中に同じcanvasへ向けた
    // より新しい呼び出しが発行されていた場合、この結果はもう古いため転写しない
    if (canvasRenderGeneration.get(canvas) === generation) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Canvas context not available');
      }
      context.drawImage(offscreen, 0, 0);
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

// ワーカー初期化
initWorker();
