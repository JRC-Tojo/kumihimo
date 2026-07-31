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
import type { PDFDocumentProxy, PageViewport } from 'pdfjs-dist';
import {
  PDFDocument,
  PDFHexString,
  rgb,
  StandardFonts,
  moveTo,
  lineTo,
  closePath,
  stroke,
  fillAndStroke,
  setLineWidth,
  setDashPattern,
  setStrokingRgbColor,
  setFillingRgbColor,
  appendBezierCurve,
  degrees,
} from 'pdf-lib';
import type { PDFContext, PDFFont, PDFOperator, PDFPage } from 'pdf-lib';
import { DocumentSource } from 'src/models/document/common';
import type { Result } from 'src/models/error/result';
import { Success, Failure, toError } from 'src/models/error/result';
import type { AnnotationStyle, ArrowHeadType, TextItemBox } from 'src/models/document/pdf';
import { base64ToUint8Array, uint8ArrayToBase64 } from 'src/utils/binary/base64';
import type { BoundingBox } from 'src/models/common';
import { ANNOTATION_GEOMETRY } from 'src/components/Viewer/Annotation/annotationGeometry';
import {
  computeHeadTransform,
  getHeadLocalPoints,
  getHeadRadius,
  isClosedHead,
  isFilledHead,
} from 'src/components/Viewer/Annotation/arrowHeadGeometry';
import { strokeTypeToDash } from 'src/utils/document/strokeDash';
import type { FileIdentity } from 'src/utils/document/fileKey';
import { acquirePdfDocument } from 'src/repositories/document/pdfDocumentCache';
import { renderAnnotationsOntoCanvas } from 'src/repositories/document/annotationCanvasRenderer';

/**
 * PDF をロードして PDFDocumentProxy を返す（Result でラップ）
 *
 * このまま返すPDFDocumentProxyはキャッシュされない使い捨てのため、呼び出し側は使い終わったら
 * 必ず`.destroy()`すること（破棄しないとpdf.js内部のWorkerスレッドが解放されない）。
 * ファイル単位で繰り返しアクセスする場合は、代わりに`pdfDocumentCache`の
 * `acquirePdfDocument`（戻り値の`release()`で返却）を使うこと
 */
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

/**
 * 既に取得済みのPDFDocumentProxyから、指定ページのサイズ（PDFポイント単位）を取得する
 *
 * 同一ファイルの複数ページを続けて処理する場合（`hostContext.ts`が全ページの
 * サイズ・テキスト・画像を先読みする箇所等）は、ページ数分`loadPdfFromSrc64`し直す
 * `getPageSize`ではなく、`acquirePdfDocument`で1回だけ取得したPDFDocumentProxyを
 * 使い回すこちらを呼ぶこと
 */
export async function getPageSizeFromDoc(
  pdf: PDFDocumentProxy,
  pageNumber: number,
): Promise<Result<{ width: number; height: number }>> {
  try {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    return Success({ width: viewport.width, height: viewport.height });
  } catch (e) {
    return Failure(toError(e));
  }
}

/** 指定ページのサイズ（PDFポイント単位）を取得する */
export async function getPageSize(
  src64: DocumentSource,
  pageNumber: number,
): Promise<Result<{ width: number; height: number }>> {
  const loaded = await loadPdfFromSrc64(src64);
  if (!loaded.ok) return Failure(loaded.error);
  try {
    return await getPageSizeFromDoc(loaded.value, pageNumber);
  } finally {
    void loaded.value.destroy();
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
  } finally {
    void loaded.value.destroy();
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
  } finally {
    void loaded.value.destroy();
  }
}

/** 2D affine変換行列 `[a, b, c, d, e, f]`（`x' = a*x + c*y + e`, `y' = b*x + d*y + f`） */
type Mat2D = [number, number, number, number, number, number];

/**
 * 2つの2D affine変換行列を合成する（`m1 ∘ m2`。`m2`を先に適用してから`m1`を適用するのと同じ）。
 * pdf.jsの`Util.transform`と同じ計算だが、pdf.jsは`DOMMatrix`（DOM API）に依存しておりNode/bun
 * テスト環境で読み込めないため、幾何計算だけをここに切り出して依存を避けている
 */
function combineTransforms(m1: Mat2D, m2: Mat2D): Mat2D {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/**
 * pdf.jsのテキストアイテム（`transform`行列由来の左下原点座標）を、左上原点の
 * バウンディングボックスへ変換する（`extractTextByAnnot`/`extractTextBlocksByPage`で共用）
 *
 * `viewport.transform`（ページ回転・スケールを含む）と`item.transform`（文字ブロック自身の
 * ベースライン変換）を合成し、ベースライン起点＋回転角度をもとに矩形の4隅をビューポート空間
 * （左上原点）へ回転させたうえで外接矩形を求める。`item.transform[4]/[5]`と`item.height`だけを
 * 使う単純計算では、90°/270°回転したPDFやskewを含む文字で矩形がずれるため
 */
function pdfItemToBox(
  item: { str?: string; transform?: Mat2D; width?: number; height?: number },
  viewport: PageViewport,
): TextItemBox | null {
  if (item.str === undefined || item.str === '') return null;
  if (item.transform === undefined || item.width === undefined || item.height === undefined) {
    return null;
  }

  // viewport空間（左上原点、Y軸下向き）でのベースライン起点＋回転角度
  const combined = combineTransforms(viewport.transform as Mat2D, item.transform);
  const baseX = combined[4];
  const baseY = combined[5];
  const angle = Math.atan2(combined[1], combined[0]);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  // ベースラインを起点に、文字は「上方向（ローカルY軸負方向）」へheight分、
  // 「右方向（ローカルX軸正方向）」へwidth分広がる矩形として4隅を回転させる
  const localCorners: Array<[number, number]> = [
    [0, 0],
    [item.width, 0],
    [0, -item.height],
    [item.width, -item.height],
  ];
  const worldXs: number[] = [];
  const worldYs: number[] = [];
  for (const [lx, ly] of localCorners) {
    worldXs.push(baseX + lx * cos - ly * sin);
    worldYs.push(baseY + lx * sin + ly * cos);
  }

  const x = Math.min(...worldXs);
  const y = Math.min(...worldYs);
  const width = Math.max(...worldXs) - x;
  const height = Math.max(...worldYs) - y;

  return { text: item.str, x, y, width, height };
}

/**
 * 指定ページの全テキストを、位置情報（左上原点のバウンディングボックス）付きで抽出する
 *
 * `extractTextByAnnot`と異なりアノテーション範囲でのフィルタは行わず、ページ内の全アイテムを
 * そのまま返す。プラグインのホストAPI（`doc.getPageTextBlocks`）向けの汎用版
 */
/** `extractTextBlocksByPage`の、既に取得済みのPDFDocumentProxyを使い回す版（`getPageSizeFromDoc`と同じ理由） */
export async function extractTextBlocksByPageFromDoc(
  pdf: PDFDocumentProxy,
  pageNumber: number,
): Promise<Result<TextItemBox[]>> {
  try {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });

    const blocks: TextItemBox[] = [];
    for (const item of textContent.items) {
      const box = pdfItemToBox(
        item as { str?: string; transform?: Mat2D; width?: number; height?: number },
        viewport,
      );
      if (box) blocks.push(box);
    }
    return Success(blocks);
  } catch (e) {
    return Failure(toError(e));
  }
}

export async function extractTextBlocksByPage(
  src64: DocumentSource,
  pageNumber: number,
): Promise<Result<TextItemBox[]>> {
  const loaded = await loadPdfFromSrc64(src64);
  if (!loaded.ok) return Failure(loaded.error);
  try {
    return await extractTextBlocksByPageFromDoc(loaded.value, pageNumber);
  } finally {
    void loaded.value.destroy();
  }
}

/**
 * 指定ページ内の、アノテーション領域に含まれるテキストを抽出する
 *
 * `file`はキャッシュキー（ファイル単位でのPDFDocumentProxy再利用）に使う。同一ファイルに対する
 * 短時間の連続呼び出し（例: アノテーション移動のたびの内容再読込）で毎回PDF全体を
 * 読み込み直さないようにするため、`pdfDocumentCache`経由でPDFDocumentProxyを取得する
 */
export async function extractTextByAnnot(
  file: FileIdentity,
  src64: DocumentSource,
  style: AnnotationStyle,
): Promise<Result<string>> {
  const acquired = await acquirePdfDocument(file, src64);
  if (!acquired.ok) return Failure(acquired.error);

  try {
    const page = await acquired.value.document.getPage(style.pageNumber);
    const textContent = await page.getTextContent();
    const bbox = calculateBoundingBox(style);
    // PDF のテキスト座標系（左下原点・Y軸上向き）を bbox の座標系（左上原点・Y軸下向き）に揃えるために使用
    const viewport = page.getViewport({ scale: 1 });
    // 文字ごとの幅の内訳推定に使う（pdf.js の TextLayer 自体が採用している手法に準拠）
    const measureCtx = document.createElement('canvas').getContext('2d');

    const extractedTexts: string[] = [];

    for (const item of textContent.items) {
      const box = pdfItemToBox(
        item as { str?: string; transform?: Mat2D; width?: number; height?: number },
        viewport,
      );
      if (!box || !('str' in item)) continue;

      const tx = box.x;
      const itemWidth = box.width;
      const itemHeight = box.height;
      const itemTopY = box.y;

      // item は複数文字を含むブロック情報のため、文字単位の疑似的な位置をもとに
      // アノテーション範囲との重なりを判定する
      const chars = Array.from(box.text);
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
  } finally {
    acquired.value.release();
  }
}

/**
 * 全ページのテキストを抽出する（ページごとの配列を返す）
 *
 * `extractTextByPage`をページ数分呼ぶとページごとにPDF全体を読み込み直してしまうため、
 * ここでは1回だけ読み込んだPDFDocumentProxyを使い回す
 */
export async function extractAllText(src64: DocumentSource): Promise<Result<string[]>> {
  const loaded = await loadPdfFromSrc64(src64);
  if (!loaded.ok) return Failure(loaded.error);
  try {
    const pages: string[] = [];
    for (let i = 1; i <= loaded.value.numPages; i++) {
      // await を順に行う — 大きな PDF は並列化を検討
      const page = await loaded.value.getPage(i);
      const textContent = await page.getTextContent();
      const strings = (textContent.items as Array<{ str?: string }>).map((it) =>
        typeof it.str === 'string' ? it.str : '',
      );
      pages.push(strings.join(' '));
    }
    return Success(pages);
  } catch (e) {
    return Failure(toError(e));
  } finally {
    void loaded.value.destroy();
  }
}

/** 既に取得済みのPDFDocumentProxyから、指定ページをレンダリングしたCanvasを返す */
export async function renderPageToCanvasFromDoc(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
): Promise<Result<HTMLCanvasElement>> {
  try {
    const page = await pdf.getPage(pageNumber);
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

/** 指定ページをレンダリングして Canvas を返す（ブラウザ環境向け。都度PDFを読み込んで使い捨てる） */
export async function renderPageToCanvas(
  src64: DocumentSource,
  pageNumber: number,
  scale = 1,
): Promise<Result<HTMLCanvasElement>> {
  const loaded = await loadPdfFromSrc64(src64);
  if (!loaded.ok) return Failure(loaded.error);
  try {
    return await renderPageToCanvasFromDoc(loaded.value, pageNumber, scale);
  } finally {
    void loaded.value.destroy();
  }
}

/** annotStyle の種類に応じて外接矩形を計算する（アノテーション自体のタイトな範囲） */
function calculateBoundingBox(style: AnnotationStyle): BoundingBox {
  return ANNOTATION_GEOMETRY[style.type].boundingBox(style);
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
  file: FileIdentity,
  src64: DocumentSource,
  annotStyle: AnnotationStyle,
  scale = 2,
): Promise<Result<string>> {
  const targetRect = calculateBoundingBox(annotStyle);

  const acquired = await acquirePdfDocument(file, src64);
  if (!acquired.ok) return Failure(acquired.error);

  try {
    const rendered = await renderPageToCanvasFromDoc(
      acquired.value.document,
      annotStyle.pageNumber,
      scale,
    );
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
  } finally {
    acquired.value.release();
  }
}

/**
 * アノテーションの周辺の文脈も確認できるようにするためのプレビュー画像を生成する。
 * アノテーション自体の領域のみを切り出すのではなく、そのページの一部を広めに切り出し、
 * アノテーション位置に強調枠を描画した上で返す（ページ全体ではなく、アノテーション周辺にズームする）
 */
export async function extractAnnotationContextPreview(
  file: FileIdentity,
  src64: DocumentSource,
  annotStyle: AnnotationStyle,
  scale = 2,
): Promise<Result<string>> {
  const tightRect = calculateBoundingBox(annotStyle);

  const acquired = await acquirePdfDocument(file, src64);
  if (!acquired.ok) return Failure(acquired.error);

  try {
    const rendered = await renderPageToCanvasFromDoc(
      acquired.value.document,
      annotStyle.pageNumber,
      scale,
    );
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
  } finally {
    acquired.value.release();
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
          strokeOpacity: typeof a.opacity === 'number' ? a.opacity : undefined,
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
  } finally {
    void loaded.value.destroy();
  }
}

/** 16進カラーコード（"#rgb"/"#rrggbb"）を0〜1範囲のRGB成分へ変換する */
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

/**
 * pdf.js（画面表示・アノテーション座標の記録側）が使う「見た目どおりの空間」
 * （左上原点・Y下向き、ページの`/Rotate`を反映した幅・高さ）の座標を、pdf-libの生のページ座標空間
 * （MediaBox基準・左下原点・Y上向き、`/Rotate`未反映）へ変換する。
 *
 * アノテーションのx/y・pointsは、pdf.jsの`page.getViewport({scale})`が作る空間（`/Rotate`が
 * 90/270のページでは幅・高さが入れ替わる）で記録されている。pdf-libの`page.getSize()`は
 * MediaBoxそのもの（`/Rotate`未反映）を返すため、`/Rotate`が0以外のページでは単純な
 * `pageHeight - y`変換だけでは座標がずれる（横長ページ等で位置・向きがおかしくなる不具合の原因）。
 * ここでの変換はpdf.js内部の`PageViewport`が採用する回転行列と等価な計算になっている
 */
function visualToRawPageSpace(screenX: number, screenY: number, page: PDFPage): { x: number; y: number } {
  const mediaBox = page.getMediaBox();
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  const mw = mediaBox.width;
  const mh = mediaBox.height;

  let rawX: number;
  let rawY: number;
  switch (rotation) {
    case 90:
      rawX = screenY;
      rawY = screenX;
      break;
    case 180:
      rawX = mw - screenX;
      rawY = screenY;
      break;
    case 270:
      rawX = mw - screenY;
      rawY = mh - screenX;
      break;
    default:
      rawX = screenX;
      rawY = mh - screenY;
  }
  return { x: rawX + mediaBox.x, y: rawY + mediaBox.y };
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

    for (const a of annotations) {
      const pageIndex = a.pageNumber - 1;
      if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) continue;
      const page = pdfDoc.getPage(pageIndex);

      // 線色未設定（「線色なし」）の場合、以前は赤色で代替描画していたが、これは意図しない
      // フォールバックだった。未設定は「枠線を描画しない」ものとして扱う
      const color = a.color ? hexToRgb(a.color) : undefined;
      const opacity = a.strokeOpacity ?? a.opacity ?? 1;
      const strokeWidth = a.strokeWidth ?? 2;

      if (a.type === 'box') {
        const { x, y, width, height } = a;
        const pageHeight = page.getSize().height;
        page.drawRectangle({
          x,
          y: pageHeight - y - height,
          width,
          height,
          ...(color
            ? { borderColor: rgb(color.r, color.g, color.b), borderWidth: strokeWidth }
            : {}),
          opacity,
        });
      } else if (a.type === 'line') {
        if (!color) continue; // 線色が無ければ描画するものが無い
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
        const { x, y, radius, radiusX, radiusY } = a;
        const pageHeight = page.getSize().height;
        page.drawEllipse({
          x,
          y: pageHeight - y,
          // 楕円化されている場合はradiusX/radiusYを使い、未設定（正円）の場合はradiusにフォールバックする
          xScale: radiusX ?? radius,
          yScale: radiusY ?? radius,
          ...(color
            ? { borderColor: rgb(color.r, color.g, color.b), borderWidth: strokeWidth }
            : {}),
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

/**
 * 矢印の矢じり種別を、PDF仕様（`/LE`）の線端形状名へ変換する
 */
function arrowHeadTypeToLineEnding(head: ArrowHeadType) {
  const map: Record<ArrowHeadType, string> = {
    none: 'None',
    triangle: 'ClosedArrow',
    open: 'OpenArrow',
    square: 'Square',
    circle: 'Circle',
    diamond: 'Diamond',
    butt: 'Butt',
    slash: 'Slash',
    reverseOpen: 'ROpenArrow',
    reverseTriangle: 'RClosedArrow',
  };
  return map[head];
}

/** フォントファミリー名・太さから、pdf-libの標準14フォントへの近似マッピングを返す */
function mapFontFamilyToStandardFont(fontFamily: string, fontWeight: number): StandardFonts {
  const family = fontFamily.toLowerCase();
  const bold = fontWeight >= 700; // TextBoxAnnotation.vueのfontStyle判定と同じ閾値に揃える

  if (family.includes('courier') || family.includes('mono') || family.includes('consolas')) {
    return bold ? StandardFonts.CourierBold : StandardFonts.Courier;
  }
  if (family.includes('serif') && !family.includes('sans')) {
    return bold ? StandardFonts.TimesRomanBold : StandardFonts.TimesRoman;
  }
  return bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica;
}

/** ローカル座標(x,y)を指定角度（度）で回転し、原点(originX,originY)を加算して絶対座標を求める */
function rotateAndTranslate(
  x: number,
  y: number,
  angleDeg: number,
  originX: number,
  originY: number,
): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: originX + x * cos - y * sin, y: originY + x * sin + y * cos };
}

/** 円1つ分のPDF描画命令（4本のベジェ曲線による近似）を返す。塗り・線とも同色で描く前提 */
function buildCircleOperators(cx: number, cy: number, r: number): PDFOperator[] {
  const k = 0.5522847498;
  return [
    moveTo(cx + r, cy),
    appendBezierCurve(cx + r, cy + r * k, cx + r * k, cy + r, cx, cy + r),
    appendBezierCurve(cx - r * k, cy + r, cx - r, cy + r * k, cx - r, cy),
    appendBezierCurve(cx - r, cy - r * k, cx - r * k, cy - r, cx, cy - r),
    appendBezierCurve(cx + r * k, cy - r, cx + r, cy - r * k, cx + r, cy),
    closePath(),
    fillAndStroke(),
  ];
}

/** 矢じり1つ分の形状（PDF空間・Y上向きに変換済み）。'none'または退化した端点の場合はnull */
interface HeadShape {
  kind: 'polygon' | 'circle';
  vertices?: { x: number; y: number }[];
  closed?: boolean;
  filled?: boolean;
  center?: { x: number; y: number };
  radius?: number;
}

/**
 * 矢じり1つ分の形状を計算する。`points`はアノテーションのx/yを起点とした相対座標
 * （スクリーン空間・Y下向き）のため、絶対座標へ変換した後に`toRaw`でPDFの生の座標空間へ揃える
 */
function computeHeadShape(
  headType: ArrowHeadType,
  headSize: number,
  points: readonly number[],
  end: 'start' | 'end',
  originX: number,
  originY: number,
  toRaw: (screenX: number, screenY: number) => { x: number; y: number },
): HeadShape | null {
  if (headType === 'none') return null;
  const transform = computeHeadTransform(points, end);
  if (!transform) return null;

  if (headType === 'circle') {
    const radius = getHeadRadius(headType, headSize);
    if (!radius) return null;
    const center = rotateAndTranslate(
      0,
      0,
      transform.angleDeg,
      originX + transform.tipX,
      originY + transform.tipY,
    );
    return { kind: 'circle', center: toRaw(center.x, center.y), radius };
  }

  const localPoints = getHeadLocalPoints(headType, headSize);
  if (!localPoints) return null;

  const vertices: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < localPoints.length; i += 2) {
    const p = rotateAndTranslate(
      localPoints[i]!,
      localPoints[i + 1]!,
      transform.angleDeg,
      originX + transform.tipX,
      originY + transform.tipY,
    );
    vertices.push(toRaw(p.x, p.y));
  }
  return { kind: 'polygon', vertices, closed: isClosedHead(headType), filled: isFilledHead(headType) };
}

/** 矢じり1つ分の形状を、PDF描画命令へ変換する（塗り・線の色・幅は呼び出し側で設定済みの前提） */
function headShapeToOperators(shape: HeadShape): PDFOperator[] {
  if (shape.kind === 'circle') return buildCircleOperators(shape.center!.x, shape.center!.y, shape.radius!);

  const vertices = shape.vertices!;
  const ops: PDFOperator[] = [moveTo(vertices[0]!.x, vertices[0]!.y)];
  for (let i = 1; i < vertices.length; i++) ops.push(lineTo(vertices[i]!.x, vertices[i]!.y));
  if (shape.closed) ops.push(closePath());
  ops.push(shape.filled ? fillAndStroke() : stroke());
  return ops;
}

/** 矢じり1つ分の形状の外接矩形を返す（外観ストリームのBBox計算用） */
function headShapeBounds(shape: HeadShape): BoundingBox {
  if (shape.kind === 'circle') {
    const { x, y } = shape.center!;
    const r = shape.radius!;
    return { x: x - r, y: y - r, width: r * 2, height: r * 2 };
  }
  const xs = shape.vertices!.map((v) => v.x);
  const ys = shape.vertices!.map((v) => v.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

/**
 * 矢印/ポリラインのシャフト＋矢じりを`headSize`どおりに描くための外観ストリーム（`/AP`/`N`）を
 * 構築して登録し、参照を返す。
 *
 * PDFのネイティブ`/LE`（線端形状）にはサイズを表すフィールドが無く、ビューア既定のサイズで
 * 描かれてしまうため、独自の外観ストリームとして焼き込むことで`headSize`をビューアに依存せず
 * 正確に反映する。注釈自体は引き続きネイティブのLine/PolyLine注釈のままのため、
 * Acrobatのコメントパネルからの参照・削除は維持される
 */
function buildArrowAppearanceStream(
  context: PDFContext,
  shaftVerticesScreen: { x: number; y: number }[],
  dash: number[] | undefined,
  startHead: ArrowHeadType,
  endHead: ArrowHeadType,
  headSize: number,
  pointsScreen: readonly number[],
  originX: number,
  originY: number,
  toRaw: (screenX: number, screenY: number) => { x: number; y: number },
  color: { r: number; g: number; b: number },
  strokeWidth: number,
) {
  const startShape = computeHeadShape(startHead, headSize, pointsScreen, 'start', originX, originY, toRaw);
  const endShape = computeHeadShape(endHead, headSize, pointsScreen, 'end', originX, originY, toRaw);
  const shaftVerticesPdf = shaftVerticesScreen.map((v) => toRaw(v.x, v.y));

  const halfStroke = strokeWidth / 2;
  const shaftXs = shaftVerticesPdf.map((v) => v.x);
  const shaftYs = shaftVerticesPdf.map((v) => v.y);
  let minX = Math.min(...shaftXs) - halfStroke;
  let minY = Math.min(...shaftYs) - halfStroke;
  let maxX = Math.max(...shaftXs) + halfStroke;
  let maxY = Math.max(...shaftYs) + halfStroke;
  for (const shape of [startShape, endShape]) {
    if (!shape) continue;
    const bounds = headShapeBounds(shape);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }

  const ops: PDFOperator[] = [
    setStrokingRgbColor(color.r, color.g, color.b),
    setFillingRgbColor(color.r, color.g, color.b),
    setLineWidth(strokeWidth),
  ];
  if (dash && dash.length > 0) ops.push(setDashPattern(dash, 0));
  ops.push(moveTo(shaftVerticesPdf[0]!.x, shaftVerticesPdf[0]!.y));
  for (let i = 1; i < shaftVerticesPdf.length; i++) {
    ops.push(lineTo(shaftVerticesPdf[i]!.x, shaftVerticesPdf[i]!.y));
  }
  ops.push(stroke());
  // 矢じり自体はKonva描画と同様、線種（dash）は適用せず常に実線で描く
  if (dash && dash.length > 0) ops.push(setDashPattern([], 0));
  if (startShape) ops.push(...headShapeToOperators(startShape));
  if (endShape) ops.push(...headShapeToOperators(endShape));

  const stream = context.formXObject(ops, { BBox: [minX, minY, maxX, maxY] });
  return context.register(stream);
}

/**
 * PDF にアノテーションをネイティブの注釈オブジェクト（コメント）として埋め込む。
 * `embedAnnotationsIntoPdf`（図形をページ内容として焼き込む＝非可逆）とは異なり、
 * Acrobat等の「コメント」パネルから個別に参照・削除できる`/Annots`エントリを追加する。
 * `extractAnnotationsFromPdf`が読み取る対象と対をなす、書き込み側の処理
 */
export async function embedAnnotationsAsCommentsIntoPdf(
  src64: DocumentSource,
  annotations: AnnotationStyle[],
): Promise<Result<DocumentSource>> {
  try {
    const pdfDoc = await PDFDocument.load(src64);
    const context = pdfDoc.context;
    // 標準14フォントの埋め込みは注釈間で共有し、同じフォントを重複して埋め込まないようにする
    const fontCache = new Map<StandardFonts, { font: PDFFont; resourceName: string }>();

    for (const a of annotations) {
      const pageIndex = a.pageNumber - 1;
      if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) continue;
      const page = pdfDoc.getPage(pageIndex);
      const toRaw = (screenX: number, screenY: number) => visualToRawPageSpace(screenX, screenY, page);

      const color = a.color ? hexToRgb(a.color) : undefined;
      const strokeWidth = a.strokeWidth ?? 2;
      const opacity = a.strokeOpacity ?? a.opacity ?? 1;
      const halfStroke = strokeWidth / 2;
      const dash = strokeTypeToDash(a.strokeType, strokeWidth);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dictLiteral: Record<string, any> = {
        Type: 'Annot',
        F: 4, // Print フラグ（印刷・他ビューアでの表示互換のため付与）
        CA: opacity,
        ...(color ? { C: [color.r, color.g, color.b] } : {}),
        ...(strokeWidth
          ? { BS: { W: strokeWidth, ...(dash ? { S: 'D', D: dash } : {}) } }
          : {}),
        ...(a.content ? { Contents: PDFHexString.fromText(a.content) } : {}),
      };

      if (a.type === 'box') {
        const { x, y, width, height, fillColor, fillOpacity } = a;
        const p1 = toRaw(x, y);
        const p2 = toRaw(x + width, y + height);
        dictLiteral.Subtype = 'Square';
        dictLiteral.Rect = [
          Math.min(p1.x, p2.x),
          Math.min(p1.y, p2.y),
          Math.max(p1.x, p2.x),
          Math.max(p1.y, p2.y),
        ];
        if (fillColor) {
          const fc = hexToRgb(fillColor);
          dictLiteral.IC = [fc.r, fc.g, fc.b];
        }
        if (fillOpacity !== undefined) dictLiteral.CA = fillOpacity;
      } else if (a.type === 'circle') {
        const { x, y, radius, radiusX, radiusY, fillColor, fillOpacity } = a;
        // /Rotateが90/270の場合、水平・垂直の半径がスクリーン空間とPDF生空間で入れ替わる
        const rotation = ((page.getRotation().angle % 360) + 360) % 360;
        const swapAxes = rotation === 90 || rotation === 270;
        const rawRx = swapAxes ? (radiusY ?? radius) : (radiusX ?? radius);
        const rawRy = swapAxes ? (radiusX ?? radius) : (radiusY ?? radius);
        const center = toRaw(x, y);
        dictLiteral.Subtype = 'Circle';
        dictLiteral.Rect = [
          center.x - rawRx,
          center.y - rawRy,
          center.x + rawRx,
          center.y + rawRy,
        ];
        if (fillColor) {
          const fc = hexToRgb(fillColor);
          dictLiteral.IC = [fc.r, fc.g, fc.b];
        }
        if (fillOpacity !== undefined) dictLiteral.CA = fillOpacity;
      } else if (a.type === 'line' || a.type === 'arrow') {
        const { x, y, points } = a;
        if (!Array.isArray(points) || points.length < 4) continue;
        const [, , dx, dy] = points;
        if (typeof dx !== 'number' || typeof dy !== 'number') continue;
        const p1 = toRaw(x, y);
        const p2 = toRaw(x + dx, y + dy);
        dictLiteral.Subtype = 'Line';
        dictLiteral.L = [p1.x, p1.y, p2.x, p2.y];
        dictLiteral.Rect = [
          Math.min(p1.x, p2.x) - halfStroke,
          Math.min(p1.y, p2.y) - halfStroke,
          Math.max(p1.x, p2.x) + halfStroke,
          Math.max(p1.y, p2.y) + halfStroke,
        ];
        if (a.type === 'arrow') {
          dictLiteral.LE = [
            arrowHeadTypeToLineEnding(a.startHead),
            arrowHeadTypeToLineEnding(a.endHead),
          ];
          // ネイティブの/LEにはheadSize相当のフィールドが無いため、実際に表示される見た目は
          // 独自の外観ストリームで焼き込み、headSizeをビューアに依存せず正確に反映する
          if (color) {
            const apRef = buildArrowAppearanceStream(
              context,
              [
                { x, y },
                { x: x + dx, y: y + dy },
              ],
              dash,
              a.startHead,
              a.endHead,
              a.headSize,
              points,
              x,
              y,
              toRaw,
              color,
              strokeWidth,
            );
            dictLiteral.AP = { N: apRef };
          }
        }
      } else if (a.type === 'polyline' || a.type === 'polygon') {
        const { x, y, points } = a;
        if (!Array.isArray(points) || points.length < 4) continue;
        const verticesRaw: number[] = [];
        const verticesScreen: { x: number; y: number }[] = [];
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (let i = 0; i + 1 < points.length; i += 2) {
          const sx = x + points[i]!;
          const sy = y + points[i + 1]!;
          verticesScreen.push({ x: sx, y: sy });
          const p = toRaw(sx, sy);
          verticesRaw.push(p.x, p.y);
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
        dictLiteral.Subtype = a.type === 'polyline' ? 'PolyLine' : 'Polygon';
        dictLiteral.Vertices = verticesRaw;
        dictLiteral.Rect = [
          minX - halfStroke,
          minY - halfStroke,
          maxX + halfStroke,
          maxY + halfStroke,
        ];
        if (a.type === 'polyline') {
          dictLiteral.LE = [
            arrowHeadTypeToLineEnding(a.startHead),
            arrowHeadTypeToLineEnding(a.endHead),
          ];
          // 矢印と同じ理由で、headSizeを正確に反映するための独自の外観ストリームを焼き込む
          if (color) {
            const apRef = buildArrowAppearanceStream(
              context,
              verticesScreen,
              dash,
              a.startHead,
              a.endHead,
              a.headSize,
              points,
              x,
              y,
              toRaw,
              color,
              strokeWidth,
            );
            dictLiteral.AP = { N: apRef };
          }
        } else if (a.fillColor) {
          const fc = hexToRgb(a.fillColor);
          dictLiteral.IC = [fc.r, fc.g, fc.b];
          if (a.fillOpacity !== undefined) dictLiteral.CA = a.fillOpacity;
        }
      } else if (a.type === 'text') {
        const { x, y, width, height, text, fontSize, textColor, fontFamily, fontWeight, textAlign, fillColor, fillOpacity } =
          a;
        const textRgb = hexToRgb(textColor);
        const textP1 = toRaw(x, y);
        const textP2 = toRaw(x + width, y + height);
        dictLiteral.Subtype = 'FreeText';
        dictLiteral.Rect = [
          Math.min(textP1.x, textP2.x),
          Math.min(textP1.y, textP2.y),
          Math.max(textP1.x, textP2.x),
          Math.max(textP1.y, textP2.y),
        ];
        dictLiteral.Contents = PDFHexString.fromText(text);
        dictLiteral.Q = textAlign === 'center' ? 1 : textAlign === 'right' ? 2 : 0;
        if (fillColor) {
          const fc = hexToRgb(fillColor);
          dictLiteral.IC = [fc.r, fc.g, fc.b];
        }
        if (fillOpacity !== undefined) dictLiteral.CA = fillOpacity;
        delete dictLiteral.C;

        // フォントは標準14フォントへ近似マッピングし、注釈自身の/DRから/DAで参照する
        // （/Helv固定だと実際のfontFamily/fontWeightがビューア既定フォントに埋もれて反映されなかった）
        const stdFont = mapFontFamilyToStandardFont(fontFamily, fontWeight);
        let cachedFont = fontCache.get(stdFont);
        if (!cachedFont) {
          cachedFont = { font: pdfDoc.embedStandardFont(stdFont), resourceName: `F${fontCache.size}` };
          fontCache.set(stdFont, cachedFont);
        }
        dictLiteral.DR = { Font: { [cachedFont.resourceName]: cachedFont.font.ref } };
        dictLiteral.DA = `${textRgb.r} ${textRgb.g} ${textRgb.b} rg /${cachedFont.resourceName} ${fontSize} Tf`;
      } else {
        continue;
      }

      const annotDict = context.obj(dictLiteral);
      const annotRef = context.register(annotDict);
      page.node.addAnnot(annotRef);
    }

    const out = await pdfDoc.save();
    return uint8ToDocSrc(out);
  } catch (e) {
    return Failure(toError(e));
  }
}

/**
 * PDFの各ページに、アノテーションを含めた「画面表示どおりの見た目」を1枚のラスタとして焼き込む
 * （非可逆）。
 *
 * `embedAnnotationsIntoPdf`（pdf-libの図形描画プリミティブで個別に再現する旧実装。矢印・折れ線・
 * テキストが未対応で、線種やブレンドモードも反映されない）とは異なり、画面描画（Konva）と同じ
 * 幾何計算・スタイル解決ロジックを再利用するCanvas 2D再描画（`annotationCanvasRenderer.ts`）で
 * ページの背景（`renderPageToCanvasFromDoc`）に注釈を重ね描きしてから1枚の画像として埋め込むため、
 * 線種・矢印サイズ・テキストの装飾・ブレンドモードを含めて画面表示と一致する。
 * pdf.jsの`viewport`はページの`/Rotate`を反映した「画面表示どおりの空間」を返すため、
 * アノテーション座標系との食い違い（横長ページ等での座標のずれ）も発生しない。
 *
 * ページ全体を1枚の画像に置き換えるため、注釈のあるページは元の（選択可能な）テキストが
 * 失われる点に注意。アノテーションが無いページは元のまま変更しない
 */
export async function embedAnnotationsAsRasterIntoPdf(
  src64: DocumentSource,
  annotations: AnnotationStyle[],
  scale = 2,
): Promise<Result<DocumentSource>> {
  const loaded = await loadPdfFromSrc64(src64);
  if (!loaded.ok) return Failure(loaded.error);

  try {
    const pdfDoc = await PDFDocument.load(src64);

    const annotationsByPage = new Map<number, AnnotationStyle[]>();
    for (const a of annotations) {
      const list = annotationsByPage.get(a.pageNumber) ?? [];
      list.push(a);
      annotationsByPage.set(a.pageNumber, list);
    }

    for (const [pageNumber, pageAnnotations] of annotationsByPage) {
      const pageIndex = pageNumber - 1;
      if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) continue;

      const rendered = await renderPageToCanvasFromDoc(loaded.value, pageNumber, scale);
      if (!rendered.ok) return Failure(rendered.error);
      const canvas = rendered.value;
      const ctx = canvas.getContext('2d');
      if (!ctx) return Failure(new Error('Canvas 2D context is not available'));

      // アノテーション座標はPDFポイント単位（scale=1相当）のため、その分をキャンバスの
      // スケールに合わせておく
      ctx.save();
      ctx.scale(scale, scale);
      renderAnnotationsOntoCanvas(ctx, pageAnnotations);
      ctx.restore();

      const pngBytesRes = base64ToUint8Array(canvas.toDataURL('image/png'));
      if (!pngBytesRes.ok) return Failure(pngBytesRes.error);

      const pngImage = await pdfDoc.embedPng(pngBytesRes.value);
      const page = pdfDoc.getPage(pageIndex);
      const widthPt = canvas.width / scale;
      const heightPt = canvas.height / scale;

      // 画像自体は既に「画面表示どおり」の向きでラスタライズ済みのため、ページの/Rotateは
      // 正規化してしまい、その見た目そのままのサイズをページの新しいMediaBoxとする
      page.setRotation(degrees(0));
      page.setSize(widthPt, heightPt);
      page.drawImage(pngImage, { x: 0, y: 0, width: widthPt, height: heightPt });
    }

    const out = await pdfDoc.save();
    return uint8ToDocSrc(out);
  } catch (e) {
    return Failure(toError(e));
  } finally {
    void loaded.value.destroy();
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
  embedAnnotationsAsCommentsIntoPdf,
  embedAnnotationsAsRasterIntoPdf,
};
