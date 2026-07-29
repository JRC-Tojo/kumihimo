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
import { PDFDocument, rgb } from 'pdf-lib';
import { DocumentSource } from 'src/models/document/common';
import type { Result } from 'src/models/error/result';
import { Success, Failure, toError } from 'src/models/error/result';
import type { AnnotationStyle, TextItemBox } from 'src/models/document/pdf';
import { base64ToUint8Array, uint8ArrayToBase64 } from 'src/utils/binary/base64';
import type { BoundingBox } from 'src/models/common';
import { ANNOTATION_GEOMETRY } from 'src/components/Viewer/Annotation/annotationGeometry';
import type { FileIdentity } from 'src/utils/document/fileKey';
import { acquirePdfDocument } from 'src/repositories/document/pdfDocumentCache';

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
