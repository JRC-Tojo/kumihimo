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
    await page.render(renderContext).promise;

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
 * （`canvasContext`側で`dpr`スケールを適用済みのため、`transform`自体はCSS px単位の平行移動でよい）
 */
export async function renderPageTile(
  pdfDocument: PdfDocument,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number,
  tile: TileDescriptor,
  fileKeyForCache?: string,
): Promise<void> {
  const generation = (canvasRenderGeneration.get(canvas) ?? 0) + 1;
  canvasRenderGeneration.set(canvas, generation);

  const dpr = window.devicePixelRatio || 1;
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
    const viewport = page.getViewport({ scale });

    const offscreen = document.createElement('canvas');
    offscreen.width = pixelWidth;
    offscreen.height = pixelHeight;
    const offscreenContext = offscreen.getContext('2d');
    if (!offscreenContext) {
      throw new Error('Canvas context not available');
    }
    offscreenContext.scale(dpr, dpr);

    await page.render({
      canvasContext: offscreenContext,
      viewport,
      canvas: offscreen,
      transform: [1, 0, 0, 1, -tile.x, -tile.y],
    }).promise;

    if (cacheKey !== undefined) {
      const bitmap = await createImageBitmap(offscreen);
      setCachedRender(cacheKey, bitmap);
    }

    if (canvasRenderGeneration.get(canvas) === generation) {
      commitToCanvas(canvas, offscreen, pixelWidth, pixelHeight, tile.width, tile.height);
    }
  } catch (error) {
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

// ワーカー初期化
initWorker();
