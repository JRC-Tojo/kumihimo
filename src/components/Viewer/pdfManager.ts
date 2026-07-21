/**
 * PDF エディタサービス
 * アノテーション管理とPDF操作の統合サービス
 */

import * as pdfjsLib from 'pdfjs-dist';
import type { ContainerElementFile } from 'src/models/container';
import type { DocumentSource } from 'src/models/document/common';
import {
  acquirePdfDocument,
  releasePdfDocument,
} from 'src/repositories/document/pdfDocumentCache';

export type PdfDocument = pdfjsLib.PDFDocumentProxy;

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
 * 取得したら、使い終わり次第（タブを閉じる等）必ず`releasePdf`を呼ぶこと
 */
export async function acquirePdf(
  file: ContainerElementFile,
  docSrc: DocumentSource,
): Promise<PdfDocument> {
  const res = await acquirePdfDocument(file, docSrc);
  if (!res.ok) throw new Error(`PDF読み込みエラー: ${res.error.message}`);
  return res.value;
}

/** `acquirePdf`で取得したPDFDocumentProxyの参照を返却する */
export function releasePdf(file: ContainerElementFile): void {
  releasePdfDocument(file);
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
  try {
    const page = await pdfDocument.getPage(pageNumber);
    let viewport = page.getViewport({ scale });
    if (maxWidth !== 0) {
      viewport = page.getViewport({ scale: maxWidth / viewport.width });
    }

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas context not available');
    }

    // 高解像度ディスプレイ（Retina等）対応
    const dpr = window.devicePixelRatio || 1;
    canvas.width = viewport.width * dpr;
    canvas.height = viewport.height * dpr;
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    // レンダリングコンテキストをDPRに合わせてスケール
    context.scale(dpr, dpr);

    const renderContext = {
      canvasContext: context,
      viewport: viewport,
      canvas: canvas,
    };

    await page.render(renderContext).promise;
    return { width: viewport.width, height: viewport.height };
  } catch (error) {
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
