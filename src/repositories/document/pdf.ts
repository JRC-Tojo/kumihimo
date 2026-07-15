/**
 * PDFデータのDocumnetSourceを受け取って、内容の読み取りや編集を行う
 *
 * TODO: テストの追加
 *
 * - 関数ベースで実装
 * - 読み取り系（テキスト抽出、ページレンダリング、領域切り出し）を標準実装
 * - 変更系（ページ追加/削除、PDFへのアノテーション埋め込み）は `pdf-lib` を利用して実装
 */

import { getDocument } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PDFDocument, rgb } from 'pdf-lib';
import { DocumentSource } from 'src/models/document/common';
import type { Result } from 'src/models/error/result';
import { Success, Failure, toError } from 'src/models/error/result';
import type { AnnotationStyle } from 'src/models/document/pdf';
import { base64ToUint8Array, uint8ArrayToBase64 } from 'src/utils/binary/base64';
import type { BoundingBox } from 'src/models/common';

/** PDF をロードして PDFDocumentProxy を返す（Result でラップ） */
export async function loadPdfFromSrc64(src64: DocumentSource): Promise<Result<PDFDocumentProxy>> {
  const data = base64ToUint8Array(src64);
  if (!data.ok) return data;

  try {
    const pdf = await getDocument({ data: data.value }).promise;
    return Success(pdf);
  } catch (e) {
    return Failure(toError(e));
  }
}

/** ページ数を取得する */
export async function getNumPages(src64: DocumentSource): Promise<Result<number>> {
  const loaded = await loadPdfFromSrc64(src64);
  if (!loaded.ok) return Failure(loaded.error);
  try {
    return Success(loaded.value.numPages);
  } catch (e) {
    return Failure(toError(e));
  }
}

/** 指定ページのテキストを抽出する（簡易） */
export async function extractTextByPage(
  src64: DocumentSource,
  pageNumber: number,
): Promise<Result<string>> {
  const loaded = await loadPdfFromSrc64(src64);
  if (!loaded.ok) return Failure(loaded.error);
  try {
    const page = await loaded.value.getPage(pageNumber);
    const textContent = await page.getTextContent();
    // items の型がバラつくため最小限に処理
    const strings = (textContent.items as Array<{ str?: string }>).map((it) =>
      typeof it.str === 'string' ? it.str : '',
    );
    return Success(strings.join(' '));
  } catch (e) {
    return Failure(toError(e));
  }
}

/**
 * 指定ページ内の、アノテーション領域に含まれるテキストを抽出する
 */
export async function extractTextByAnnot(
  src64: DocumentSource,
  style: AnnotationStyle,
): Promise<Result<string>> {
  const loaded = await loadPdfFromSrc64(src64);
  if (!loaded.ok) return Failure(loaded.error);

  try {
    const page = await loaded.value.getPage(style.pageNumber);
    const textContent = await page.getTextContent();
    const bbox = calculateBoundingBox(style);
    // PDF のテキスト座標系（左下原点・Y軸上向き）を bbox の座標系（左上原点・Y軸下向き）に揃えるために使用
    const pageHeight = page.getViewport({ scale: 1 }).height;
    // 文字ごとの幅の内訳推定に使う（pdf.js の TextLayer 自体が採用している手法に準拠）
    const measureCtx = document.createElement('canvas').getContext('2d');

    const extractedTexts: string[] = [];

    for (const item of textContent.items) {
      if (!('str' in item) || !('transform' in item) || item.str === '') continue;

      // item.transform は [scaleX, skewY, skewX, scaleY, translateX, translateY] の配列
      const tx = item.transform[4]; // X座標（左下原点）
      const ty = item.transform[5]; // Y座標（左下原点）
      const itemWidth = item.width;
      const itemHeight = item.height;
      const itemTopY = pageHeight - ty - itemHeight; // 左上原点でのY座標に変換

      // item は複数文字を含むブロック情報のため、文字単位の疑似的な位置をもとに
      // アノテーション範囲との重なりを判定する
      const chars = Array.from(item.str);
      const fontFamily = textContent.styles[item.fontName]?.fontFamily;
      const charWidths = estimateCharWidths(measureCtx, chars, itemWidth, fontFamily);

      const matchedChars: string[] = [];
      let offsetX = 0;
      chars.forEach((char, i) => {
        const charWidth = charWidths[i] ?? 0;

        // 文字要素の中心点を計算（判定を少し緩くするため）
        const centerX = tx + offsetX + charWidth / 2;
        const centerY = itemTopY + itemHeight / 2;

        // 中心点がアノテーションの内部にあるか判定
        const isInsideX = centerX >= bbox.x && centerX <= bbox.x + bbox.width;
        const isInsideY = centerY >= bbox.y && centerY <= bbox.y + bbox.height;

        if (isInsideX && isInsideY) matchedChars.push(char);
        offsetX += charWidth;
      });

      if (matchedChars.length > 0) extractedTexts.push(matchedChars.join(''));
    }

    // 抽出されたテキストを結合（ブロック間はスペースで区切る）
    return Success(extractedTexts.join(' '));
  } catch (e) {
    return Failure(toError(e));
  }
}

/** 全ページのテキストを抽出する（ページごとの配列を返す） */
export async function extractAllText(src64: DocumentSource): Promise<Result<string[]>> {
  const loaded = await loadPdfFromSrc64(src64);
  if (!loaded.ok) return Failure(loaded.error);
  try {
    const pages: string[] = [];
    for (let i = 1; i <= loaded.value.numPages; i++) {
      // await を順に行う — 大きな PDF は並列化を検討
      const pageText = await extractTextByPage(src64, i);
      if (!pageText.ok) return Failure(pageText.error);
      pages.push(pageText.value);
    }
    return Success(pages);
  } catch (e) {
    return Failure(toError(e));
  }
}

/** 指定ページをレンダリングして Canvas を返す（ブラウザ環境向け） */
export async function renderPageToCanvas(
  src64: DocumentSource,
  pageNumber: number,
  scale = 1,
): Promise<Result<HTMLCanvasElement>> {
  const loaded = await loadPdfFromSrc64(src64);
  if (!loaded.ok) return Failure(loaded.error);
  try {
    const page = await loaded.value.getPage(pageNumber);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return Failure(new Error('Canvas 2D context is not available'));

    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    return Success(canvas);
  } catch (e) {
    return Failure(toError(e));
  }
}

/** annotStyle の種類に応じて外接矩形を計算する（アノテーション自体のタイトな範囲） */
function calculateBoundingBox(style: AnnotationStyle): BoundingBox {
  const padding = 2; // 矩形の外側に少し余白を付与

  switch (style.type) {
    case 'box': {
      const { x, y, width, height } = style;
      return {
        x: Math.max(0, x - padding),
        y: Math.max(0, y - padding),
        width: width + padding * 2,
        height: height + padding * 2,
      };
    }
    case 'line': {
      const { x, y, points, strokeWidth = 2 } = style;
      const [, , dx, dy] = points; // points: [0, 0, x2-x, y2-y]
      const x2 = x + (dx ?? 2);
      const y2 = y + (dy ?? 2);

      // 線幅を考慮した外接矩形を計算
      const halfStroke = strokeWidth / 2 + padding;
      const minX = Math.min(x, x2) - halfStroke;
      const maxX = Math.max(x, x2) + halfStroke;
      const minY = Math.min(y, y2) - halfStroke;
      const maxY = Math.max(y, y2) + halfStroke;

      return {
        x: Math.max(0, minX),
        y: Math.max(0, minY),
        width: maxX - minX,
        height: maxY - minY,
      };
    }
    case 'circle': {
      const { x, y, radius } = style;
      const extent = radius + padding;
      return {
        x: Math.max(0, x - extent),
        y: Math.max(0, y - extent),
        width: extent * 2,
        height: extent * 2,
      };
    }
  }
}

/**
 * item 内の各文字の疑似的な幅の内訳を推定する。
 *
 * PDF.js は item（ブロック）全体の実測幅（itemWidth）しか提供しないため、
 * Canvas 2D の measureText で文字ごとの相対的な字幅比率を求め、その比率で itemWidth を配分する。
 * これは pdf.js の TextLayer 自体が幅の補正に使っている手法（該当フォントで measureText → スケール算出）を
 * 文字単位に応用したもので、等分割よりも比例配分に近い位置を算出できる。
 * 計測できない場合は文字数による均等割りにフォールバックする。
 */
function estimateCharWidths(
  ctx: CanvasRenderingContext2D | null,
  chars: string[],
  itemWidth: number,
  fontFamily: string | undefined,
): number[] {
  const evenWidth = itemWidth / chars.length;
  if (!ctx) return chars.map(() => evenWidth);

  ctx.font = `10px ${fontFamily ?? 'sans-serif'}`;
  const rawWidths = chars.map((char) => ctx.measureText(char).width);
  const rawTotal = rawWidths.reduce((sum, w) => sum + w, 0);
  if (rawTotal <= 0) return chars.map(() => evenWidth);

  return rawWidths.map((w) => (w / rawTotal) * itemWidth);
}

/**
 * 指定ページの矩形領域を切り出して PNG の dataURL を返す。Result でラップ。
 * annotStyle で指定された領域の外接矩形を計算して切り出す
 * 直線の場合は線幅を考慮する
 */
export async function extractImageFromRegion(
  src64: DocumentSource,
  annotStyle: AnnotationStyle,
  scale = 2,
): Promise<Result<string>> {
  const targetRect = calculateBoundingBox(annotStyle);

  try {
    const rendered = await renderPageToCanvas(src64, annotStyle.pageNumber, scale);
    if (!rendered.ok) return Failure(rendered.error);
    const canvas = rendered.value;

    const tmp = document.createElement('canvas');
    tmp.width = Math.round(targetRect.width * scale);
    tmp.height = Math.round(targetRect.height * scale);
    const tctx = tmp.getContext('2d');
    if (!tctx) return Failure(new Error('Canvas 2D context is not available'));

    tctx.drawImage(
      canvas,
      Math.round(targetRect.x * scale),
      Math.round(targetRect.y * scale),
      Math.round(targetRect.width * scale),
      Math.round(targetRect.height * scale),
      0,
      0,
      Math.round(targetRect.width * scale),
      Math.round(targetRect.height * scale),
    );
    return Success(tmp.toDataURL('image/png'));
  } catch (e) {
    return Failure(toError(e));
  }
}

/**
 * アノテーションの周辺の文脈も確認できるようにするためのプレビュー画像を生成する。
 * アノテーション自体の領域のみを切り出すのではなく、そのページの一部を広めに切り出し、
 * アノテーション位置に強調枠を描画した上で返す（ページ全体ではなく、アノテーション周辺にズームする）
 */
export async function extractAnnotationContextPreview(
  src64: DocumentSource,
  annotStyle: AnnotationStyle,
  scale = 2,
): Promise<Result<string>> {
  const tightRect = calculateBoundingBox(annotStyle);

  try {
    const rendered = await renderPageToCanvas(src64, annotStyle.pageNumber, scale);
    if (!rendered.ok) return Failure(rendered.error);
    const pageCanvas = rendered.value;
    const pageWidthPt = pageCanvas.width / scale;
    const pageHeightPt = pageCanvas.height / scale;

    // アノテーション位置を強調する枠線をページ描画済みキャンバス上に描画する
    const highlightCtx = pageCanvas.getContext('2d');
    if (highlightCtx) {
      const highlightPadding = 4;
      highlightCtx.save();
      highlightCtx.strokeStyle = '#2196f3';
      highlightCtx.lineWidth = 3;
      highlightCtx.setLineDash([6, 4]);
      highlightCtx.strokeRect(
        (tightRect.x - highlightPadding) * scale,
        (tightRect.y - highlightPadding) * scale,
        (tightRect.width + highlightPadding * 2) * scale,
        (tightRect.height + highlightPadding * 2) * scale,
      );
      highlightCtx.restore();
    }

    // アノテーション周辺を含む「ズームした」範囲を計算する（タイトな範囲を拡張し、ページ範囲内にクランプ）
    const zoomPaddingX = Math.max(tightRect.width * 1.5, 80);
    const zoomPaddingY = Math.max(tightRect.height * 1.5, 80);
    const zoomX = Math.max(0, tightRect.x - zoomPaddingX);
    const zoomY = Math.max(0, tightRect.y - zoomPaddingY);
    const zoomRight = Math.min(pageWidthPt, tightRect.x + tightRect.width + zoomPaddingX);
    const zoomBottom = Math.min(pageHeightPt, tightRect.y + tightRect.height + zoomPaddingY);
    const zoomRect = {
      x: zoomX,
      y: zoomY,
      width: zoomRight - zoomX,
      height: zoomBottom - zoomY,
    };

    const tmp = document.createElement('canvas');
    tmp.width = Math.round(zoomRect.width * scale);
    tmp.height = Math.round(zoomRect.height * scale);
    const tctx = tmp.getContext('2d');
    if (!tctx) return Failure(new Error('Canvas 2D context is not available'));

    tctx.drawImage(
      pageCanvas,
      Math.round(zoomRect.x * scale),
      Math.round(zoomRect.y * scale),
      Math.round(zoomRect.width * scale),
      Math.round(zoomRect.height * scale),
      0,
      0,
      Math.round(zoomRect.width * scale),
      Math.round(zoomRect.height * scale),
    );
    return Success(tmp.toDataURL('image/png'));
  } catch (e) {
    return Failure(toError(e));
  }
}

/** PDF バイナリを base64 にして返す */
function uint8ToDocSrc(bytes: Uint8Array): Result<DocumentSource> {
  const convertedSrc = uint8ArrayToBase64(bytes);
  if (!convertedSrc.ok) return convertedSrc;
  return Success(DocumentSource.parse(convertedSrc.value));
}

/** ページの追加 */
export async function addBlankPageToPdf(
  src64: DocumentSource,
  width = 595,
  height = 842,
): Promise<Result<DocumentSource>> {
  const bytes = base64ToUint8Array(src64);
  if (!bytes.ok) return bytes;

  try {
    const pdfDoc = await PDFDocument.load(bytes.value);
    pdfDoc.addPage([width, height]);
    const out = await pdfDoc.save();
    return uint8ToDocSrc(out);
  } catch (e) {
    return Failure(toError(e));
  }
}

/** ページを削除（0始まりのインデックス） */
export async function removePageFromPdf(
  src64: DocumentSource,
  pageIndexZeroBased: number,
): Promise<Result<DocumentSource>> {
  const bytes = base64ToUint8Array(src64);
  if (!bytes.ok) return bytes;

  try {
    const pdfDoc = await PDFDocument.load(bytes.value);
    const pageCount = pdfDoc.getPageCount();
    if (pageIndexZeroBased < 0 || pageIndexZeroBased >= pageCount)
      return Failure(new Error('page index out of range'));
    pdfDoc.removePage(pageIndexZeroBased);
    const out = await pdfDoc.save();
    return uint8ToDocSrc(out);
  } catch (e) {
    return Failure(toError(e));
  }
}

/**
 * PDFデータからアノテーションデータを抽出する
 */
export async function extractAnnotationsFromPdf(
  src64: DocumentSource,
): Promise<Result<AnnotationStyle[]>> {
  const loaded = await loadPdfFromSrc64(src64);
  if (!loaded.ok) return Failure(loaded.error);

  try {
    const pdf = loaded.value;
    const annotations: AnnotationStyle[] = [];
    const now = new Date().toISOString();

    function rgbArrayToHex(arr: number[] | undefined): string {
      if (!arr || arr.length < 3) return '#ff0000';
      const [r, g, b] = arr as [number, number, number];
      const to255 = (v: number) => (v <= 1 ? Math.round(v * 255) : Math.round(v));
      const hr = to255(r).toString(16).padStart(2, '0');
      const hg = to255(g).toString(16).padStart(2, '0');
      const hb = to255(b).toString(16).padStart(2, '0');
      return `#${hr}${hg}${hb}`;
    }

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const pageHeight = page.getViewport({ scale: 1 }).height;

      // TODO: AnnotationIDの保持方法と戻す方法を検討する
      // AnnotationIDが付与されていない新規Annotationの時は新規にIDを付与する
      const anns = await page.getAnnotations();

      for (const a of anns) {
        // skip non-visible or widget annotations
        if (a.subtype === 'Widget' || a.hidden || a.flags?.noView) continue;

        const common = {
          pageNumber: i,
          color: rgbArrayToHex(a.color),
          strokeWidth: a.borderWidth ?? a.border?.width ?? 2,
          opacity: typeof a.opacity === 'number' ? a.opacity : undefined,
          content: typeof a.contents === 'string' ? a.contents : undefined,
          createdAt: now,
          updatedAt: now,
          comment: {},
        } as const;

        // Square -> box
        if (a.subtype === 'Square' && Array.isArray(a.rect)) {
          const [x1, y1, x2, y2] = a.rect as [number, number, number, number];
          const left = Math.min(x1, x2);
          const right = Math.max(x1, x2);
          const bottom = Math.min(y1, y2);
          const top = Math.max(y1, y2);
          const width = right - left;
          const height = top - bottom;
          const y = pageHeight - top; // convert to top-based y

          annotations.push({
            type: 'box',
            ...common,
            x: left,
            y,
            width,
            height,
          } as AnnotationStyle);
          continue;
        }

        // Circle
        if (a.subtype === 'Circle' && Array.isArray(a.rect)) {
          const [x1, y1, x2, y2] = a.rect as [number, number, number, number];
          const left = Math.min(x1, x2);
          const right = Math.max(x1, x2);
          const bottom = Math.min(y1, y2);
          const top = Math.max(y1, y2);
          const width = right - left;
          const height = top - bottom;
          const cx = left + width / 2;
          const cy_topDistance = pageHeight - top;
          const radius = Math.max(width, height) / 2;

          annotations.push({
            type: 'circle',
            ...common,
            x: cx,
            // keep y as center distance from top (consistent with embed logic)
            y: cy_topDistance + radius,
            radius,
          } as unknown as AnnotationStyle);
          continue;
        }

        // Ink (freehand) -> approximate as line using first stroke
        if (a.subtype === 'Ink' && Array.isArray(a.inkLists) && a.inkLists.length > 0) {
          const firstList = a.inkLists[0] as number[];
          if (firstList.length >= 4) {
            const x = firstList[0] as number;
            const yPdf = firstList[1] as number;
            const x2 = firstList[firstList.length - 2] as number;
            const y2Pdf = firstList[firstList.length - 1] as number;
            const y = pageHeight - yPdf;
            const y2 = pageHeight - y2Pdf;
            annotations.push({
              type: 'line',
              ...common,
              x,
              y,
              x2,
              y2,
              points: [0, 0, x2 - x, y2 - y],
            } as unknown as AnnotationStyle);
            continue;
          }
        }

        // fallback: any rect -> box
        if (Array.isArray(a.rect)) {
          const [x1, y1, x2, y2] = a.rect as [number, number, number, number];
          const left = Math.min(x1, x2);
          const right = Math.max(x1, x2);
          const bottom = Math.min(y1, y2);
          const top = Math.max(y1, y2);
          const width = right - left;
          const height = top - bottom;
          const y = pageHeight - top;
          annotations.push({
            type: 'box',
            ...common,
            x: left,
            y,
            width,
            height,
          } as unknown as AnnotationStyle);
        }
      }
    }

    return Success(annotations);
  } catch (e) {
    return Failure(toError(e));
  }
}

/**
 * PDF にアノテーションを焼き込む。Annotation 型に応じて矩形や線、円を描画する。
 * 返り値は編集後の DocumentSource を Result で返す
 */
export async function embedAnnotationsIntoPdf(
  src64: DocumentSource,
  annotations: AnnotationStyle[],
): Promise<Result<DocumentSource>> {
  try {
    const pdfDoc = await PDFDocument.load(src64);

    function hexToRgb(hex: string) {
      const h = hex.replace('#', '');
      const bigint = parseInt(
        h.length === 3
          ? h
              .split('')
              .map((c) => c + c)
              .join('')
          : h,
        16,
      );
      const r = (bigint >> 16) & 255;
      const g = (bigint >> 8) & 255;
      const b = bigint & 255;
      return { r: r / 255, g: g / 255, b: b / 255 };
    }

    for (const a of annotations) {
      const pageIndex = a.pageNumber - 1;
      if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) continue;
      const page = pdfDoc.getPage(pageIndex);

      const color = hexToRgb(a.color || '#ff0000');
      const opacity = typeof a.opacity === 'number' ? a.opacity : 1;
      const strokeWidth = a.strokeWidth ?? 2;

      if (a.type === 'box') {
        const { x, y, width, height } = a;
        const pageHeight = page.getSize().height;
        page.drawRectangle({
          x,
          y: pageHeight - y - height,
          width,
          height,
          borderColor: rgb(color.r, color.g, color.b),
          borderWidth: strokeWidth,
          opacity,
        });
      } else if (a.type === 'line') {
        const { x, y, points } = a;
        if (!Array.isArray(points) || points.length < 4) continue;
        const [, , width, height] = points;
        if (typeof width !== 'number' || typeof height !== 'number') continue;
        const pageHeight = page.getSize().height;
        page.drawLine({
          start: { x, y: pageHeight - y },
          end: { x: x + width, y: pageHeight - (y + height) },
          thickness: strokeWidth,
          color: rgb(color.r, color.g, color.b),
        });
      } else if (a.type === 'circle') {
        const { x, y, radius } = a;
        const pageHeight = page.getSize().height;
        page.drawEllipse({
          x,
          y: pageHeight - y,
          xScale: radius,
          yScale: radius,
          borderColor: rgb(color.r, color.g, color.b),
          borderWidth: strokeWidth,
          opacity,
        });
      }
    }

    const out = await pdfDoc.save();
    return uint8ToDocSrc(out);
  } catch (e) {
    return Failure(toError(e));
  }
}

// Export まとめ
export default {
  loadPdfFromSrc64,
  getNumPages,
  extractTextByAnnot,
  extractTextByPage,
  extractAllText,
  renderPageToCanvas,
  extractImageFromRegion,
  addBlankPageToPdf,
  removePageFromPdf,
  embedAnnotationsIntoPdf,
};
