import { describe, expect, it, mock, afterEach, afterAll } from 'bun:test';
import { inflateSync } from 'zlib';
import { readFileSync } from 'fs';
import path from 'path';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  PDFDocument,
  PDFDict,
  PDFArray,
  PDFName,
  PDFHexString,
  PDFStream,
  type PDFRawStream,
  type PDFRef,
  degrees,
  type PDFNumber,
} from 'pdf-lib';
import { JSDOM } from 'jsdom';
import { createCanvas } from 'canvas';
import type { TextItemBox, AnnotationStyle } from 'src/models/document/pdf';
import { AnnotationID, ColorCode } from 'src/models/document/pdf';
import type { BookmarkID, BookmarkInfo } from 'src/models/relational/fileSchema';
import { DocumentSource } from 'src/models/document/common';
import type { FileIdentity } from 'src/utils/document/fileKey';
import { ContainerID } from 'src/models/container';
import type { Result } from 'src/models/error/result';
import { Success, Failure } from 'src/models/error/result';
import { base64ToUint8Array, uint8ArrayToBase64 } from 'src/utils/binary/base64';

/**
 * pdfjs-distの`getDocument`をモック化するための差し替え可能な実装ホルダー。
 * `loadPdfFromSrc64`（内部で`getDocument({data}).promise`を呼ぶ）を経由する関数群
 * （getPageSize/getNumPages/extractTextByPage/extractAllText/extractAnnotationsFromPdf/
 * renderPageToCanvas等）のテストでは、各テストケースの実行前にこの変数を書き換えることで、
 * 返すPDFDocumentProxyや失敗挙動をテストごとに切り替える。実際のpdfjs-distはDOMMatrix等
 * ブラウザAPIに依存するため、モジュールごと差し替えて実体を一切importしないようにする
 */
type FakeGetDocumentImpl = (options: { data: Uint8Array }) => { promise: Promise<unknown> };
let fakeGetDocumentImpl: FakeGetDocumentImpl = () => ({
  promise: Promise.reject(new Error('fakeGetDocumentImpl is not configured for this test')),
});

void mock.module('pdfjs-dist', () => ({
  getDocument: (options: { data: Uint8Array }) => fakeGetDocumentImpl(options),
  version: '0.0.0-test',
}));

/**
 * pdfDocumentCacheの`acquirePdfDocument`をモック化するための差し替え可能な実装ホルダー。
 * `extractImageFromRegion`/`extractAnnotationContextPreview`はこれ経由でPDFDocumentProxyを
 * 取得するため、実際のキャッシュ・破棄タイマー処理（DISPOSE_GRACE_MS）に依存させないよう
 * モジュールごとモック化する（pdfDocumentCache.ts自体のテストは別ファイルで行われる）
 */
type FakeAcquireImpl = (
  file: FileIdentity,
  src64: DocumentSource,
) => Promise<Result<{ document: unknown; release: () => void }>>;
let fakeAcquireImpl: FakeAcquireImpl = () =>
  Promise.resolve(Failure(new Error('fakeAcquireImpl is not configured for this test')));

void mock.module('src/repositories/document/pdfDocumentCache', () => ({
  acquirePdfDocument: (file: FileIdentity, src64: DocumentSource) => fakeAcquireImpl(file, src64),
  invalidatePdfDocument: () => {},
}));

// pdfjs-distはモジュール読み込み時（トップレベル）に`new DOMMatrix()`を評価するため、
// DOMのないbunテスト環境ではimportするだけで`ReferenceError`になる。実際にレンダリング系の
// 機能（Canvas描画等）は本テストの経路では呼ばれないため、コンストラクタが例外を投げない
// 最小限のスタブで十分。動的importの前に登録する必要があるためトップレベルawaitを使う
// （上記のmock.module('pdfjs-dist', ...)により実体は読み込まれない想定だが、フォールバックとして
// 従来通り残しておく）
if (typeof globalThis.DOMMatrix === 'undefined') {
  (globalThis as unknown as { DOMMatrix: unknown }).DOMMatrix = class {};
}

const {
  extractTextBlocksByPageFromDoc,
  getPageSize,
  getNumPages,
  extractTextByPage,
  extractAllText,
  extractAnnotationsFromPdf,
  renderPageToCanvasFromDoc,
  renderPageToCanvas,
  addBlankPageToPdf,
  removePageFromPdf,
  embedAnnotationsIntoPdf,
  embedAnnotationsAsCommentsIntoPdf,
  embedAnnotationsAsVectorIntoPdf,
  embedBookmarksIntoPdf,
  extractImageFromRegion,
  extractAnnotationContextPreview,
  getOutline,
  anyTextWillFallbackToStandardFont,
} = await import('../pdf');

/**
 * pdf.jsの`PageViewport`が実際に生成する変換行列（scale=1, viewBox=[0,0,200,100]）を
 * 回転角度ごとに手計算で再現したもの（`PageViewport`コンストラクタのロジックに基づく）
 */
function buildViewport(rotation: 0 | 90 | 180 | 270) {
  const transforms: Record<typeof rotation, number[]> = {
    0: [1, 0, 0, -1, 0, 100],
    90: [0, 1, 1, 0, 0, 0],
    180: [-1, 0, 0, 1, 200, 0],
    270: [0, -1, -1, 0, 100, 200],
  };
  return { transform: transforms[rotation] };
}

/**
 * `extractTextBlocksByPageFromDoc`のテストで使う、最小限のPDFDocumentProxyモックを生成する。
 * PDF空間上の位置(50, 20)・スケール1・回転無しの文字ブロック（"AB"）を1件持つページを、
 * 指定した回転角度のビューポートで返す（`pdfItemToBox`の回転考慮を検証するため）
 */
function buildFakePdf(rotation: 0 | 90 | 180 | 270) {
  const item = {
    str: 'AB',
    dir: 'ltr',
    // PDF空間上の位置(50, 20)に置かれた、スケール1・回転無しの文字ブロック
    transform: [1, 0, 0, 1, 50, 20],
    width: 30,
    height: 12,
    fontName: 'f1',
    hasEOL: false,
  };
  return {
    getPage: () =>
      Promise.resolve({
        getTextContent: () => Promise.resolve({ items: [item], styles: {} }),
        getViewport: () => buildViewport(rotation),
      }),
  } as unknown as PDFDocumentProxy;
}

/**
 * 三角関数由来（`Math.cos`/`Math.sin`）の浮動小数端数を許容するため、`TextItemBox`の
 * 各数値フィールドを`toBeCloseTo`で比較する（`toEqual`による完全一致比較は使わない）
 */
function expectBoxCloseTo(box: TextItemBox | undefined, expected: TextItemBox): void {
  expect(box?.text).toBe(expected.text);
  expect(box?.x).toBeCloseTo(expected.x);
  expect(box?.y).toBeCloseTo(expected.y);
  expect(box?.width).toBeCloseTo(expected.width);
  expect(box?.height).toBeCloseTo(expected.height);
}

describe('extractTextBlocksByPageFromDoc（pdfItemToBox）', () => {
  it('回転無し（0度）のページでは、ベースライン位置からwidth/heightそのままの矩形になる', async () => {
    const res = await extractTextBlocksByPageFromDoc(buildFakePdf(0), 1);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    expect(res.value).toHaveLength(1);
    expectBoxCloseTo(res.value[0], { text: 'AB', x: 50, y: 68, width: 30, height: 12 });
  });

  it('90度回転したページでは、width/heightが入れ替わった矩形になる（回転を考慮しない実装では検知できない回帰）', async () => {
    const res = await extractTextBlocksByPageFromDoc(buildFakePdf(90), 1);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    expect(res.value).toHaveLength(1);
    expectBoxCloseTo(res.value[0], { text: 'AB', x: 20, y: 50, width: 12, height: 30 });
  });

  it('180度回転したページでは、位置は反転するがwidth/heightは0度と同じになる', async () => {
    const res = await extractTextBlocksByPageFromDoc(buildFakePdf(180), 1);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    expect(res.value).toHaveLength(1);
    expectBoxCloseTo(res.value[0], { text: 'AB', x: 120, y: 20, width: 30, height: 12 });
  });

  it('270度回転したページでも、90度と同様にwidth/heightが入れ替わり、座標も正しく変換される', async () => {
    const res = await extractTextBlocksByPageFromDoc(buildFakePdf(270), 1);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    expect(res.value).toHaveLength(1);
    expectBoxCloseTo(res.value[0], { text: 'AB', x: 68, y: 120, width: 12, height: 30 });
  });
});

// ============================================================
// グループA: pdf-lib依存（DOM/Canvas不要、実際のpdf-libでPDFを生成してテストする）
// ============================================================

/** テスト用に最小限のpdf-lib PDFを実際に生成し、base64化したDocumentSourceとして返す */
async function buildTestPdfSrc(
  pageCount = 1,
  size: [number, number] = [200, 100],
): Promise<DocumentSource> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage(size);
  const bytes = await doc.save();
  const b64 = uint8ArrayToBase64(bytes);
  if (!b64.ok) throw b64.error;
  return DocumentSource.parse(b64.value);
}

/** base64のDocumentSourceをpdf-libのPDFDocumentへ読み戻す（テストでの検証用） */
async function loadTestPdf(src64: DocumentSource) {
  const bytes = base64ToUint8Array(src64);
  if (!bytes.ok) throw bytes.error;
  return PDFDocument.load(bytes.value);
}

/** テスト用PDFの指定ページに`/Rotate`を設定し直したDocumentSourceを返す */
async function withPageRotation(
  src64: DocumentSource,
  pageIndex: number,
  rotationDeg: 0 | 90 | 180 | 270,
): Promise<DocumentSource> {
  const doc = await loadTestPdf(src64);
  doc.getPage(pageIndex).setRotation(degrees(rotationDeg));
  const bytes = await doc.save();
  const b64 = uint8ArrayToBase64(bytes);
  if (!b64.ok) throw b64.error;
  return DocumentSource.parse(b64.value);
}

/** 指定ページのコンテンツストリームを、Flate圧縮を解凍したうえで文字列として取得する（テスト検証用） */
function getPageContentString(doc: PDFDocument, pageIndex: number): string {
  const contents = doc.getPage(pageIndex).node.Contents();
  const decode = (s: PDFStream): string => {
    const raw = s as unknown as PDFRawStream;
    try {
      return inflateSync(Buffer.from(raw.getContents())).toString('binary');
    } catch {
      return Buffer.from(raw.getContents()).toString('binary');
    }
  };
  if (contents instanceof PDFArray) {
    return contents
      .asArray()
      .map((ref) => decode(doc.context.lookup(ref, PDFStream)))
      .join('\n');
  }
  return contents ? decode(contents) : '';
}

const TEST_ANNOTATION_ID = AnnotationID.parse('11111111-1111-4111-8111-111111111111');
const TEST_COLOR = ColorCode.parse('#ff0000');

/** 複数のアノテーション種別のテストで共通して使うベースフィールドを組み立てる */
function buildAnnotationBase(pageNumber: number) {
  return {
    id: TEST_ANNOTATION_ID,
    pageNumber,
    x: 10,
    y: 10,
    color: TEST_COLOR,
    strokeWidth: 2,
    strokeType: 'solid' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    comment: {},
  };
}

function buildBoxAnnotation(pageNumber = 1): AnnotationStyle {
  return { ...buildAnnotationBase(pageNumber), type: 'box', width: 50, height: 30 };
}

/** Canvas切り出し系テスト用に、100x100のフェイクページ内に収まる小さめのbox */
function buildSmallBoxAnnotation(pageNumber = 1): AnnotationStyle {
  return {
    ...buildAnnotationBase(pageNumber),
    type: 'box',
    x: 5,
    y: 5,
    width: 10,
    height: 8,
  };
}

function buildLineAnnotation(pageNumber = 1): AnnotationStyle {
  return { ...buildAnnotationBase(pageNumber), type: 'line', points: [0, 0, 50, 60] };
}

function buildCircleAnnotation(pageNumber = 1): AnnotationStyle {
  return { ...buildAnnotationBase(pageNumber), type: 'circle', radius: 15 };
}

function buildArrowAnnotation(pageNumber = 1): AnnotationStyle {
  return {
    ...buildAnnotationBase(pageNumber),
    type: 'arrow',
    points: [0, 0, 50, 60],
    startHead: 'none',
    endHead: 'triangle',
    headSize: 10,
  };
}

function buildPolylineAnnotation(pageNumber = 1): AnnotationStyle {
  return {
    ...buildAnnotationBase(pageNumber),
    type: 'polyline',
    points: [0, 0, 20, 10, 40, 0],
    startHead: 'none',
    endHead: 'none',
    headSize: 10,
  };
}

function buildPolygonAnnotation(pageNumber = 1): AnnotationStyle {
  return {
    ...buildAnnotationBase(pageNumber),
    type: 'polygon',
    points: [0, 0, 20, 0, 10, 20],
    fillColor: TEST_COLOR,
    fillOpacity: 0.5,
  };
}

function buildTextAnnotation(pageNumber = 1): AnnotationStyle {
  return {
    ...buildAnnotationBase(pageNumber),
    type: 'text',
    width: 100,
    height: 40,
    text: 'コメント本文',
    fontFamily: 'sans-serif',
    fontSize: 16,
    fontWeight: 400,
    textColor: TEST_COLOR,
    textAlign: 'left',
  };
}

describe('addBlankPageToPdf / removePageFromPdf（pdf-lib、実PDFを使用）', () => {
  it('addBlankPageToPdf: 指定したサイズのページが追加され、ページ数が1つ増える', async () => {
    const src = await buildTestPdfSrc(1);
    const res = await addBlankPageToPdf(src, 100, 50);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const loaded = await loadTestPdf(res.value);
    expect(loaded.getPageCount()).toBe(2);
    const size = loaded.getPage(1).getSize();
    expect(size.width).toBeCloseTo(100);
    expect(size.height).toBeCloseTo(50);
  });

  it('addBlankPageToPdf: サイズ省略時はデフォルト（595x842）のページを追加する', async () => {
    const src = await buildTestPdfSrc(1);
    const res = await addBlankPageToPdf(src);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const loaded = await loadTestPdf(res.value);
    const size = loaded.getPage(1).getSize();
    expect(size.width).toBeCloseTo(595);
    expect(size.height).toBeCloseTo(842);
  });

  it('addBlankPageToPdf: 不正なPDFバイナリの場合はFailureを返す', async () => {
    const invalidBytes = uint8ArrayToBase64(new TextEncoder().encode('not a pdf'));
    if (!invalidBytes.ok) throw invalidBytes.error;
    const res = await addBlankPageToPdf(DocumentSource.parse(invalidBytes.value));
    expect(res.ok).toBeFalse();
  });

  it('removePageFromPdf: 指定したページを削除する', async () => {
    const src = await buildTestPdfSrc(2);
    const res = await removePageFromPdf(src, 0);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const loaded = await loadTestPdf(res.value);
    expect(loaded.getPageCount()).toBe(1);
  });

  it('removePageFromPdf: 範囲外のindex（負数）はFailureを返す', async () => {
    const src = await buildTestPdfSrc(1);
    const res = await removePageFromPdf(src, -1);
    expect(res.ok).toBeFalse();
  });

  it('removePageFromPdf: 範囲外のindex（ページ数以上）はFailureを返す', async () => {
    const src = await buildTestPdfSrc(1);
    const res = await removePageFromPdf(src, 1);
    expect(res.ok).toBeFalse();
  });
});

describe('embedAnnotationsIntoPdf（pdf-lib）', () => {
  it('box/line/circle それぞれをエラーなく埋め込み、Successを返す', async () => {
    const src = await buildTestPdfSrc(1, [300, 300]);
    const res = await embedAnnotationsIntoPdf(src, [
      buildBoxAnnotation(1),
      buildLineAnnotation(1),
      buildCircleAnnotation(1),
    ]);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const loaded = await loadTestPdf(res.value);
    expect(loaded.getPageCount()).toBe(1);
  });

  it('存在しないページ番号を指すアノテーションは無視される（エラーにならない）', async () => {
    const src = await buildTestPdfSrc(1, [300, 300]);
    const res = await embedAnnotationsIntoPdf(src, [buildBoxAnnotation(99)]);
    expect(res.ok).toBeTrue();
  });

  it('線色未設定（「線色なし」）のbox/line/circleでもエラーにならず埋め込める（以前は赤色へフォールバックしていた）', async () => {
    const src = await buildTestPdfSrc(1, [300, 300]);
    const noColorBox = { ...buildBoxAnnotation(1), color: undefined };
    const noColorLine = { ...buildLineAnnotation(1), color: undefined };
    const noColorCircle = { ...buildCircleAnnotation(1), color: undefined };

    const res = await embedAnnotationsIntoPdf(src, [noColorBox, noColorLine, noColorCircle]);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const loaded = await loadTestPdf(res.value);
    expect(loaded.getPageCount()).toBe(1);
  });
});

describe('embedAnnotationsAsCommentsIntoPdf（pdf-lib、ネイティブ注釈として埋め込み）', () => {
  /** 保存後のPDFから、指定ページの`/Annots`をPDFDictの配列として取得する */
  async function getAnnotDicts(src64: DocumentSource, pageIndex = 0): Promise<PDFDict[]> {
    const doc = await loadTestPdf(src64);
    const page = doc.getPage(pageIndex);
    const annots = page.node.Annots();
    if (!annots) return [];
    return annots.asArray().map((ref) => doc.context.lookup(ref, PDFDict));
  }

  function subtypeOf(dict: PDFDict): string {
    return dict.get(PDFName.of('Subtype'))?.toString() ?? '';
  }

  function numbersOf(dict: PDFDict, key: string): number[] {
    const arr = dict.lookup(PDFName.of(key), PDFArray);
    return arr.asArray().map((n) => (n as PDFNumber).asNumber());
  }

  it('box/circle/line/arrow/polyline/polygon/textの全種別をエラーなく埋め込み、Successを返す', async () => {
    const src = await buildTestPdfSrc(1, [300, 300]);
    const res = await embedAnnotationsAsCommentsIntoPdf(src, [
      buildBoxAnnotation(1),
      buildCircleAnnotation(1),
      buildLineAnnotation(1),
      buildArrowAnnotation(1),
      buildPolylineAnnotation(1),
      buildPolygonAnnotation(1),
      buildTextAnnotation(1),
    ]);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const dicts = await getAnnotDicts(res.value);
    expect(dicts).toHaveLength(7);
    expect(dicts.map(subtypeOf)).toEqual([
      '/Square',
      '/Circle',
      '/Line',
      '/Line',
      '/PolyLine',
      '/Polygon',
      '/FreeText',
    ]);
  });

  it('boxはSquare注釈として、指定した位置・サイズに応じたRectを持つ', async () => {
    const src = await buildTestPdfSrc(1, [300, 300]);
    const res = await embedAnnotationsAsCommentsIntoPdf(src, [buildBoxAnnotation(1)]);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const [dict] = await getAnnotDicts(res.value);
    expect(dict).toBeDefined();
    if (!dict) return;
    expect(subtypeOf(dict)).toBe('/Square');
    // buildAnnotationBase: x=10, y=10 / buildBoxAnnotation: width=50, height=30 / ページ高さ300
    expect(numbersOf(dict, 'Rect')).toEqual([10, 260, 60, 290]);
  });

  it('arrowはLine注釈として、start/endHeadに対応する/LEを持つ', async () => {
    const src = await buildTestPdfSrc(1, [300, 300]);
    const res = await embedAnnotationsAsCommentsIntoPdf(src, [buildArrowAnnotation(1)]);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const [dict] = await getAnnotDicts(res.value);
    expect(dict).toBeDefined();
    if (!dict) return;
    expect(subtypeOf(dict)).toBe('/Line');
    const le = dict.lookup(PDFName.of('LE'));
    expect(le?.toString()).toBe('[ /None /ClosedArrow ]');
  });

  it('polygonはfillColor/fillOpacity指定時に/IC・/CAを持つ', async () => {
    const src = await buildTestPdfSrc(1, [300, 300]);
    const res = await embedAnnotationsAsCommentsIntoPdf(src, [buildPolygonAnnotation(1)]);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const [dict] = await getAnnotDicts(res.value);
    expect(dict).toBeDefined();
    if (!dict) return;
    expect(subtypeOf(dict)).toBe('/Polygon');
    expect(dict.get(PDFName.of('IC'))).toBeDefined();
    expect((dict.lookup(PDFName.of('CA')) as PDFNumber).asNumber()).toBeCloseTo(0.5);
  });

  it('textはFreeText注釈として本文を保持する', async () => {
    const src = await buildTestPdfSrc(1, [300, 300]);
    const res = await embedAnnotationsAsCommentsIntoPdf(src, [buildTextAnnotation(1)]);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const [dict] = await getAnnotDicts(res.value);
    expect(dict).toBeDefined();
    if (!dict) return;
    expect(subtypeOf(dict)).toBe('/FreeText');
    const contents = dict.lookup(PDFName.of('Contents'), PDFHexString);
    expect(contents.decodeText()).toBe('コメント本文');
  });

  it('存在しないページ番号を指すアノテーションは無視される（エラーにならない）', async () => {
    const src = await buildTestPdfSrc(1, [300, 300]);
    const res = await embedAnnotationsAsCommentsIntoPdf(src, [buildBoxAnnotation(99)]);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const dicts = await getAnnotDicts(res.value);
    expect(dicts).toHaveLength(0);
  });

  it('strokeTypeが線種指定の場合、BSに/D（ダッシュパターン）を持つ', async () => {
    const src = await buildTestPdfSrc(1, [300, 300]);
    const dashedBox = { ...buildBoxAnnotation(1), strokeType: 'dashed' as const };
    const res = await embedAnnotationsAsCommentsIntoPdf(src, [dashedBox]);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const [dict] = await getAnnotDicts(res.value);
    expect(dict).toBeDefined();
    if (!dict) return;
    const bs = dict.lookup(PDFName.of('BS'), PDFDict);
    expect(bs.get(PDFName.of('S'))?.toString()).toBe('/D');
    expect(numbersOf(bs, 'D').length).toBeGreaterThan(0);
  });

  it('strokeTypeがsolidの場合はBSに/Dを持たない', async () => {
    const src = await buildTestPdfSrc(1, [300, 300]);
    const res = await embedAnnotationsAsCommentsIntoPdf(src, [buildBoxAnnotation(1)]);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const [dict] = await getAnnotDicts(res.value);
    expect(dict).toBeDefined();
    if (!dict) return;
    const bs = dict.lookup(PDFName.of('BS'), PDFDict);
    expect(bs.get(PDFName.of('D'))).toBeUndefined();
  });

  it('color未設定のarrowはAP（外観ストリーム）を持たない', async () => {
    const src = await buildTestPdfSrc(1, [300, 300]);
    const noColorArrow = { ...buildArrowAnnotation(1), color: undefined };
    const res = await embedAnnotationsAsCommentsIntoPdf(src, [noColorArrow]);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const [dict] = await getAnnotDicts(res.value);
    expect(dict).toBeDefined();
    if (!dict) return;
    expect(dict.get(PDFName.of('AP'))).toBeUndefined();
  });

  it('colorが設定されたarrowはheadSizeを反映した外観ストリーム（/AP /N）を持つ', async () => {
    const src = await buildTestPdfSrc(1, [300, 300]);
    // 水平な矢印にする（矢じりの左右への広がりがシャフト自体の外接矩形からはみ出すため、
    // headSizeの増減がBBoxの高さに直接反映され、判定しやすい）
    const horizontalArrow = { ...buildArrowAnnotation(1), points: [0, 0, 50, 0] };
    const smallHead = { ...horizontalArrow, headSize: 4 };
    const bigHead = { ...horizontalArrow, headSize: 40 };

    const smallRes = await embedAnnotationsAsCommentsIntoPdf(src, [smallHead]);
    const bigRes = await embedAnnotationsAsCommentsIntoPdf(src, [bigHead]);
    expect(smallRes.ok).toBeTrue();
    expect(bigRes.ok).toBeTrue();
    if (!smallRes.ok || !bigRes.ok) return;

    const [smallDict] = await getAnnotDicts(smallRes.value);
    const [bigDict] = await getAnnotDicts(bigRes.value);
    expect(smallDict).toBeDefined();
    expect(bigDict).toBeDefined();
    if (!smallDict || !bigDict) return;

    const smallAp = smallDict.lookup(PDFName.of('AP'), PDFDict);
    const bigAp = bigDict.lookup(PDFName.of('AP'), PDFDict);
    const smallStream = smallAp.lookup(PDFName.of('N'), PDFStream);
    const bigStream = bigAp.lookup(PDFName.of('N'), PDFStream);

    // headSizeが大きいほど外観ストリームのBBoxも大きくなる（矢じりの見た目が正確に反映されている）
    const smallBBox = smallStream.dict
      .lookup(PDFName.of('BBox'), PDFArray)
      .asArray() as PDFNumber[];
    const bigBBox = bigStream.dict.lookup(PDFName.of('BBox'), PDFArray).asArray() as PDFNumber[];
    const smallHeight = smallBBox[3]!.asNumber() - smallBBox[1]!.asNumber();
    const bigHeight = bigBBox[3]!.asNumber() - bigBBox[1]!.asNumber();
    expect(bigHeight).toBeGreaterThan(smallHeight);

    // /Rectが外観ストリームのBBoxと一致していること（矢じり分を含めないと、ビューアが
    // 外観ストリームを狭い/Rectへ縮小フィットさせてしまい、矢印の見た目がずれる）
    const bigRect = numbersOf(bigDict, 'Rect');
    const bigRectHeight = bigRect[3]! - bigRect[1]!;
    expect(bigRectHeight).toBeCloseTo(bigHeight, 5);
  });

  it('textはtextAlignを/Qへ、fillColor/fillOpacityを/IC・/CAへ変換し、/Helv固定ではない/DAを持つ', async () => {
    const src = await buildTestPdfSrc(1, [300, 300]);
    const styledText = {
      ...buildTextAnnotation(1),
      textAlign: 'center' as const,
      fontFamily: 'Courier New',
      fontWeight: 700,
      fillColor: TEST_COLOR,
      fillOpacity: 0.4,
    };
    const res = await embedAnnotationsAsCommentsIntoPdf(src, [styledText]);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const [dict] = await getAnnotDicts(res.value);
    expect(dict).toBeDefined();
    if (!dict) return;
    expect((dict.lookup(PDFName.of('Q')) as PDFNumber).asNumber()).toBe(1);
    expect(dict.get(PDFName.of('IC'))).toBeDefined();
    expect((dict.lookup(PDFName.of('CA')) as PDFNumber).asNumber()).toBeCloseTo(0.4);
    const da = dict.lookup(PDFName.of('DA'))!.toString();
    expect(da).not.toContain('/Helv ');
    const dr = dict.lookup(PDFName.of('DR'), PDFDict);
    expect(dr.lookup(PDFName.of('Font'), PDFDict)).toBeDefined();
  });

  it('半角英数字の本文＋fillColorの場合、背景色を反映した独自の外観ストリーム（/AP /N）を持つ', async () => {
    const src = await buildTestPdfSrc(1, [300, 300]);
    const latinText = {
      ...buildTextAnnotation(1),
      text: 'Hello World',
      fillColor: TEST_COLOR,
      fillOpacity: 0.4,
    };
    const res = await embedAnnotationsAsCommentsIntoPdf(src, [latinText]);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const [dict] = await getAnnotDicts(res.value);
    expect(dict).toBeDefined();
    if (!dict) return;
    expect(dict.get(PDFName.of('AP'))).toBeDefined();
  });

  it(
    '日本語の本文の場合、標準14フォントがCJK文字のグリフを持たないため外観ストリームの構築は' +
      'スキップされるが、保存自体は失敗しない（クラッシュ回避のフォールバック）',
    async () => {
      const src = await buildTestPdfSrc(1, [300, 300]);
      const jpText = { ...buildTextAnnotation(1), text: 'あいうえお', fillColor: TEST_COLOR };
      const res = await embedAnnotationsAsCommentsIntoPdf(src, [jpText]);
      expect(res.ok).toBeTrue();
      if (!res.ok) return;

      const [dict] = await getAnnotDicts(res.value);
      expect(dict).toBeDefined();
      if (!dict) return;
      expect(dict.get(PDFName.of('AP'))).toBeUndefined();
    },
  );

  it('/Rotateが90のページでは、見た目どおりの座標（画面表示側の空間）から正しくRectへ変換される', async () => {
    const baseSrc = await buildTestPdfSrc(1, [200, 100]);
    const rotatedSrc = await withPageRotation(baseSrc, 0, 90);
    // 画面側の座標系（幅200×高さ100想定）でx=10,y=10,width=50,height=30のbox
    const res = await embedAnnotationsAsCommentsIntoPdf(rotatedSrc, [buildBoxAnnotation(1)]);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const [dict] = await getAnnotDicts(res.value);
    expect(dict).toBeDefined();
    if (!dict) return;
    // rotation=90: rawX=screenY, rawY=screenX（visualToRawPageSpaceの導出どおり）。
    // 左上(10,10)→raw(10,10)、右下(60,40)→raw(40,60)
    expect(numbersOf(dict, 'Rect')).toEqual([10, 10, 40, 60]);
  });
});

// ============================================================
// グループB: pdfjs-dist経由（loadPdfFromSrc64ベース、mock.moduleでgetDocumentを差し替える）
// ============================================================

/** loadPdfFromSrc64の呼び出し自体（base64デコード）を通すためだけの、内容を問わないダミーsrc64 */
const DUMMY_SRC = DocumentSource.parse(btoa('dummy-pdf-bytes'));

/** pdfjs-distの`getDocument`モックが返す、テストごとに最小限のメソッドだけを実装したフェイクのPDFDocumentProxy */
interface FakeDocOptions {
  outline?: unknown[] | null;
  destinations?: Record<string, unknown[]>;
  pageIndexByRef?: (ref: unknown) => number;
}

function buildFakeDoc(pages: unknown[], opts: FakeDocOptions = {}): PDFDocumentProxy {
  return {
    numPages: pages.length,
    getPage: (n: number) => Promise.resolve(pages[n - 1]),
    destroy: () => Promise.resolve(),
    getOutline: () => Promise.resolve(opts.outline ?? null),
    getDestination: (id: string) => Promise.resolve(opts.destinations?.[id] ?? null),
    getPageIndex: (ref: unknown) =>
      opts.pageIndexByRef
        ? Promise.resolve(opts.pageIndexByRef(ref))
        : Promise.reject(new Error('getPageIndex is not configured for this test')),
  } as unknown as PDFDocumentProxy;
}

interface FakePageOptions {
  textItems?: Array<{ str?: string }>;
  viewport?: { width?: number; height?: number };
  annotations?: unknown[];
  renderFails?: boolean;
}

/** フェイクのPDFページ（getTextContent/getViewport/getAnnotations/renderのうち、呼び出す分だけ実装する） */
function buildFakePage(opts: FakePageOptions = {}) {
  return {
    getTextContent: () => Promise.resolve({ items: opts.textItems ?? [], styles: {} }),
    getViewport: () => opts.viewport ?? { width: 0, height: 0 },
    getAnnotations: () => Promise.resolve(opts.annotations ?? []),
    render: () => ({
      promise: opts.renderFails ? Promise.reject(new Error('render failed')) : Promise.resolve(),
    }),
  };
}

describe('getPageSize / getNumPages / extractTextByPage / extractAllText（pdfjs-distモック）', () => {
  it('getPageSize: フェイクPDFDocumentProxyから正しいページサイズを取得する', async () => {
    fakeGetDocumentImpl = () => ({
      promise: Promise.resolve(
        buildFakeDoc([buildFakePage({ viewport: { width: 210, height: 297 } })]),
      ),
    });

    const res = await getPageSize(DUMMY_SRC, 1);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toEqual({ width: 210, height: 297 });
  });

  it('getNumPages: フェイクPDFDocumentProxyのnumPagesをそのまま返す', async () => {
    fakeGetDocumentImpl = () => ({
      promise: Promise.resolve(buildFakeDoc([buildFakePage(), buildFakePage(), buildFakePage()])),
    });

    const res = await getNumPages(DUMMY_SRC);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toBe(3);
  });

  it('extractTextByPage: ページ内のテキストアイテムをスペース区切りで連結する', async () => {
    fakeGetDocumentImpl = () => ({
      promise: Promise.resolve(
        buildFakeDoc([buildFakePage({ textItems: [{ str: 'Hello' }, { str: 'World' }] })]),
      ),
    });

    const res = await extractTextByPage(DUMMY_SRC, 1);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toBe('Hello World');
  });

  it('extractAllText: 全ページ分のテキストをページごとの配列で返す', async () => {
    fakeGetDocumentImpl = () => ({
      promise: Promise.resolve(
        buildFakeDoc([
          buildFakePage({ textItems: [{ str: 'Page1' }] }),
          buildFakePage({ textItems: [{ str: 'Page2' }] }),
        ]),
      ),
    });

    const res = await extractAllText(DUMMY_SRC);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toEqual(['Page1', 'Page2']);
  });

  it('base64のデコードに失敗した場合はFailureが伝播する（getDocumentは呼ばれない）', async () => {
    const invalidSrc = 'not-valid-base64---!!!' as unknown as DocumentSource;
    const res = await getPageSize(invalidSrc, 1);
    expect(res.ok).toBeFalse();
  });

  it('getDocument().promiseがrejectした場合はFailureになる', async () => {
    fakeGetDocumentImpl = () => ({ promise: Promise.reject(new Error('parse failed')) });

    const res = await getNumPages(DUMMY_SRC);
    expect(res.ok).toBeFalse();
    if (res.ok) return;
    expect(res.error.message).toBe('parse failed');
  });
});

describe('getOutline（pdfjs-distモック）', () => {
  it('階層構造のアウトラインを、階層の深さを保持したまま平坦な配列に変換する', async () => {
    fakeGetDocumentImpl = () => ({
      promise: Promise.resolve(
        buildFakeDoc([buildFakePage(), buildFakePage(), buildFakePage()], {
          outline: [
            {
              title: '第1章',
              dest: [{ num: 0 }],
              items: [{ title: '1.1節', dest: [{ num: 1 }], items: [] }],
            },
            { title: '第2章', dest: [{ num: 2 }], items: [] },
          ],
          pageIndexByRef: (ref) => (ref as { num: number }).num,
        }),
      ),
    });

    const res = await getOutline(DUMMY_SRC);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toEqual([
      { title: '第1章', level: 0, pageNumber: 1 },
      { title: '1.1節', level: 1, pageNumber: 2 },
      { title: '第2章', level: 0, pageNumber: 3 },
    ]);
  });

  it('名前付き宛先（文字列のdest）はgetDestinationで実体を解決してからページ番号にする', async () => {
    fakeGetDocumentImpl = () => ({
      promise: Promise.resolve(
        buildFakeDoc([buildFakePage(), buildFakePage()], {
          outline: [{ title: '目次', dest: 'namedDest1', items: [] }],
          destinations: { namedDest1: [{ num: 1 }] },
          pageIndexByRef: (ref) => (ref as { num: number }).num,
        }),
      ),
    });

    const res = await getOutline(DUMMY_SRC);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toEqual([{ title: '目次', level: 0, pageNumber: 2 }]);
  });

  it('外部URLへのリンク等、ページ参照を解決できない項目はpageNumberがundefinedになる（失敗にはしない）', async () => {
    fakeGetDocumentImpl = () => ({
      promise: Promise.resolve(
        buildFakeDoc([buildFakePage()], {
          outline: [{ title: '外部リンク', dest: null, items: [] }],
        }),
      ),
    });

    const res = await getOutline(DUMMY_SRC);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toEqual([{ title: '外部リンク', level: 0, pageNumber: undefined }]);
  });

  it('アウトラインが存在しない（getOutlineがnullを返す）場合は空配列を返す', async () => {
    fakeGetDocumentImpl = () => ({
      promise: Promise.resolve(buildFakeDoc([buildFakePage()], { outline: null })),
    });

    const res = await getOutline(DUMMY_SRC);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toEqual([]);
  });
});

describe('extractAnnotationsFromPdf（pdfjs-distモック）', () => {
  it('Square/Circle/Inkを変換し、Widgetはスキップし、未知のsubtypeはboxへフォールバックする', async () => {
    const anns = [
      {
        subtype: 'Square',
        rect: [10, 700, 60, 750],
        color: [1, 0, 0],
        borderWidth: 3,
        opacity: 0.8,
        contents: 'note',
      },
      { subtype: 'Circle', rect: [100, 100, 140, 140] },
      { subtype: 'Ink', inkLists: [[5, 10, 15, 20, 25, 30]] },
      { subtype: 'Widget', rect: [0, 0, 10, 10] },
      { subtype: 'FreeText', rect: [200, 200, 220, 230] },
    ];
    fakeGetDocumentImpl = () => ({
      promise: Promise.resolve(
        buildFakeDoc([buildFakePage({ viewport: { height: 800 }, annotations: anns })]),
      ),
    });

    const res = await extractAnnotationsFromPdf(DUMMY_SRC);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    // Widgetの1件のみ除外され、残り4件が変換される
    expect(res.value).toHaveLength(4);

    const box1 = res.value[0];
    expect(box1?.type).toBe('box');
    expect(box1?.color).toBe(ColorCode.parse('#ff0000'));
    expect(box1?.strokeWidth).toBe(3);
    expect(box1?.strokeOpacity).toBe(0.8);
    expect(box1?.content).toBe('note');
    if (box1?.type === 'box') {
      expect(box1.x).toBeCloseTo(10);
      expect(box1.y).toBeCloseTo(50);
      expect(box1.width).toBeCloseTo(50);
      expect(box1.height).toBeCloseTo(50);
    }

    const circle = res.value[1];
    expect(circle?.type).toBe('circle');
    if (circle?.type === 'circle') {
      expect(circle.x).toBeCloseTo(120);
      expect(circle.y).toBeCloseTo(680);
      expect(circle.radius).toBeCloseTo(20);
    }

    const line = res.value[2];
    expect(line?.type).toBe('line');
    if (line?.type === 'line') {
      expect(line.x).toBeCloseTo(5);
      expect(line.y).toBeCloseTo(790);
      expect(line.points).toEqual([0, 0, 20, -20]);
    }

    const fallbackBox = res.value[3];
    expect(fallbackBox?.type).toBe('box');
    if (fallbackBox?.type === 'box') {
      expect(fallbackBox.x).toBeCloseTo(200);
      expect(fallbackBox.y).toBeCloseTo(570);
      expect(fallbackBox.width).toBeCloseTo(20);
      expect(fallbackBox.height).toBeCloseTo(30);
    }
  });
});

// ============================================================
// グループC: Canvas/DOM依存（jsdom + node-canvasでdocument.createElementを差し替える）
// ============================================================

/**
 * jsdomでDOM環境を注入し、`document.createElement('canvas')`をnode-canvasの実装へ差し替える。
 * `src/utils/ocr/__test__/ocr.test.ts`のbrowserEnvSetup()と同じパターン
 */
function setupCanvasDom(): void {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  global.window = dom.window as unknown as Window & typeof globalThis;
  global.document = dom.window.document;
  global.HTMLCanvasElement = dom.window.HTMLCanvasElement;
  global.document.createElement = (tagName: string) => {
    if (tagName === 'canvas') {
      return createCanvas(100, 100) as unknown as HTMLCanvasElement;
    }
    return dom.window.document.createElement(tagName);
  };
}

describe('renderPageToCanvasFromDoc / renderPageToCanvas / extractImageFromRegion / extractAnnotationContextPreview（Canvas依存）', () => {
  setupCanvasDom();

  const testFile: FileIdentity = {
    containerID: ContainerID.parse('22222222-2222-4222-8222-222222222222'),
    path: 'a.pdf',
  };

  it('renderPageToCanvasFromDoc: 正常時はSuccess(canvas)を返す', async () => {
    const fakeDoc = buildFakeDoc([buildFakePage({ viewport: { width: 100, height: 100 } })]);
    const res = await renderPageToCanvasFromDoc(fakeDoc, 1, 1);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.width).toBe(100);
    expect(res.value.height).toBe(100);
  });

  it('renderPageToCanvasFromDoc: Canvas 2Dコンテキストが取得できない場合はFailureを返す', async () => {
    const originalCreateElement = document.createElement.bind(document);
    document.createElement = (tagName: string) => {
      if (tagName === 'canvas') {
        return { width: 0, height: 0, getContext: () => null } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tagName);
    };

    try {
      const fakeDoc = buildFakeDoc([buildFakePage({ viewport: { width: 10, height: 10 } })]);
      const res = await renderPageToCanvasFromDoc(fakeDoc, 1, 1);
      expect(res.ok).toBeFalse();
    } finally {
      document.createElement = originalCreateElement;
    }
  });

  it('renderPageToCanvas: src64からloadPdfFromSrc64経由でロードしてCanvasを返す', async () => {
    fakeGetDocumentImpl = () => ({
      promise: Promise.resolve(
        buildFakeDoc([buildFakePage({ viewport: { width: 100, height: 100 } })]),
      ),
    });

    const res = await renderPageToCanvas(DUMMY_SRC, 1, 1);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.width).toBe(100);
    expect(res.value.height).toBe(100);
  });

  it('extractImageFromRegion: pdfDocumentCacheをモックし、正常系でdata:image/pngのdataURLを返す', async () => {
    const releaseSpy = mock(() => {});
    const fakeDoc = buildFakeDoc([buildFakePage({ viewport: { width: 100, height: 100 } })]);
    fakeAcquireImpl = () => Promise.resolve(Success({ document: fakeDoc, release: releaseSpy }));

    const res = await extractImageFromRegion(testFile, DUMMY_SRC, buildSmallBoxAnnotation(1));
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.startsWith('data:image/png')).toBeTrue();
    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });

  it('extractImageFromRegion: acquirePdfDocumentが失敗した場合はFailureを伝播する', async () => {
    fakeAcquireImpl = () => Promise.resolve(Failure(new Error('acquire failed')));

    const res = await extractImageFromRegion(testFile, DUMMY_SRC, buildSmallBoxAnnotation(1));
    expect(res.ok).toBeFalse();
  });

  it('extractAnnotationContextPreview: 正常系でdata:image/pngのdataURLを返す', async () => {
    const releaseSpy = mock(() => {});
    const fakeDoc = buildFakeDoc([buildFakePage({ viewport: { width: 100, height: 100 } })]);
    fakeAcquireImpl = () => Promise.resolve(Success({ document: fakeDoc, release: releaseSpy }));

    const res = await extractAnnotationContextPreview(
      testFile,
      DUMMY_SRC,
      buildSmallBoxAnnotation(1),
    );
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.startsWith('data:image/png')).toBeTrue();
    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });
});

describe('embedAnnotationsAsVectorIntoPdf（pdf-lib、ページ背景を保持したままベクタ形状で焼き込み）', () => {
  it('全種別をエラーなく焼き込み、ページ数・サイズ・/Rotateは変更しない（ページ背景を保持する）', async () => {
    const baseSrc = await buildTestPdfSrc(2, [300, 300]);
    const src = await withPageRotation(baseSrc, 0, 90);

    const res = await embedAnnotationsAsVectorIntoPdf(src, [
      buildBoxAnnotation(1),
      buildCircleAnnotation(1),
      buildLineAnnotation(1),
      buildArrowAnnotation(1),
      buildPolylineAnnotation(1),
      buildPolygonAnnotation(1),
      buildTextAnnotation(1),
    ]);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const doc = await loadTestPdf(res.value);
    expect(doc.getPageCount()).toBe(2);
    // ページの/Rotate・MediaBoxは変更されない（ページ背景がベクタのまま保持される）
    expect(doc.getPage(0).getRotation().angle).toBe(90);
    expect(doc.getPage(0).getSize()).toEqual({ width: 300, height: 300 });
    expect(doc.getPage(1).getRotation().angle).toBe(0);
  });

  it('存在しないページ番号を指すアノテーションは無視される（エラーにならない）', async () => {
    const src = await buildTestPdfSrc(1, [300, 300]);
    const res = await embedAnnotationsAsVectorIntoPdf(src, [buildBoxAnnotation(99)]);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const doc = await loadTestPdf(res.value);
    expect(doc.getPageCount()).toBe(1);
  });

  it('線種（dash）は前に描画した図形から引き継がれない（solidな図形の直前で必ずリセットされる）', async () => {
    const src = await buildTestPdfSrc(1, [300, 300]);
    const dashedBox = { ...buildBoxAnnotation(1), strokeType: 'dashed' as const };
    const solidBox = { ...buildBoxAnnotation(1), x: 100 };
    const res = await embedAnnotationsAsVectorIntoPdf(src, [dashedBox, solidBox]);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const doc = await loadTestPdf(res.value);
    const content = getPageContentString(doc, 0);
    const dashOps = [...content.matchAll(/(\[[^\]]*\]) 0 d/g)].map((m) => m[1]);
    // 1つ目（dashedBox）は破線パターン、2つ目（solidBox）は明示的にリセットされた実線（[]）であること
    expect(dashOps).toHaveLength(2);
    expect(dashOps[0]).not.toBe('[]');
    expect(dashOps[1]).toBe('[]');
  });

  it('半角英数字の本文は、埋め込んだフォントでBT/Tjとして描画される（テキストが表示される）', async () => {
    const src = await buildTestPdfSrc(1, [300, 300]);
    const latinText = { ...buildTextAnnotation(1), text: 'Hello World' };
    const res = await embedAnnotationsAsVectorIntoPdf(src, [latinText]);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const doc = await loadTestPdf(res.value);
    const content = getPageContentString(doc, 0);
    expect(content).toContain('BT');
    expect(content).toContain('Tj');
    expect(content).toContain('ET');
  });

  it('色未設定（塗り・線とも無し）のboxは何も描画しない（エラーにならない）', async () => {
    const src = await buildTestPdfSrc(1, [300, 300]);
    const noColorBox = { ...buildBoxAnnotation(1), color: undefined };
    const res = await embedAnnotationsAsVectorIntoPdf(src, [noColorBox]);
    expect(res.ok).toBeTrue();
  });

  it('スペースの無い長い日本語本文でもエラーにならず埋め込める（1文字ずつの折り返し）', async () => {
    const src = await buildTestPdfSrc(1, [300, 300]);
    const longText = {
      ...buildTextAnnotation(1),
      text: 'あ'.repeat(80),
      width: 100,
      height: 200,
      fontSize: 12,
    };
    const res = await embedAnnotationsAsVectorIntoPdf(src, [longText]);
    expect(res.ok).toBeTrue();
  });

  it('文字列に日本語（サンセリフ）を指定した場合でもHelveticaへフォールバックし、失敗しない', async () => {
    const src = await buildTestPdfSrc(1, [300, 300]);
    const res = await embedAnnotationsAsVectorIntoPdf(src, [buildTextAnnotation(1)]);
    expect(res.ok).toBeTrue();
  });
});

describe('embedBookmarksIntoPdf（pdf-lib、ネイティブしおり(Outline)として書き込み）', () => {
  interface OutlineNode {
    title: string;
    dest: unknown[];
    children: OutlineNode[];
  }

  /** 保存後のPDFから、/Root/Outlines配下の階層をJSの木構造として読み戻す（テスト検証用） */
  async function readOutlineTree(src64: DocumentSource): Promise<OutlineNode[]> {
    const doc = await loadTestPdf(src64);
    const outlinesRef = doc.catalog.get(PDFName.of('Outlines')) as PDFRef | undefined;
    if (!outlinesRef) return [];
    const outlines = doc.context.lookup(outlinesRef, PDFDict);

    const readSiblings = (firstRef: PDFRef | undefined): OutlineNode[] => {
      const nodes: OutlineNode[] = [];
      let currentRef = firstRef;
      while (currentRef) {
        const dict = doc.context.lookup(currentRef, PDFDict);
        const title = dict.lookup(PDFName.of('Title'), PDFHexString).decodeText();
        const dest = dict.lookup(PDFName.of('Dest'), PDFArray).asArray();
        const firstChildRef = dict.get(PDFName.of('First')) as PDFRef | undefined;
        nodes.push({
          title,
          dest,
          children: firstChildRef ? readSiblings(firstChildRef) : [],
        });
        currentRef = dict.get(PDFName.of('Next')) as PDFRef | undefined;
      }
      return nodes;
    };

    return readSiblings(outlines.get(PDFName.of('First')) as PDFRef | undefined);
  }

  function bm(
    id: string,
    title: string,
    pageNumber: number,
    extra: Partial<BookmarkInfo> = {},
  ): BookmarkInfo {
    return { id: id as BookmarkID, title, pageNumber, ...extra };
  }

  it('親子関係をOutlineの階層（First/Next/Parent）に反映する', async () => {
    const src = await buildTestPdfSrc(2, [300, 300]);
    const parentId = 'parent';
    const res = await embedBookmarksIntoPdf(
      src,
      [
        bm(parentId, '第1章', 1),
        bm('child-1', '1.1', 1, { parentId: parentId as BookmarkID }),
        bm('child-2', '1.2', 2, { parentId: parentId as BookmarkID }),
        bm('root-2', '第2章', 2),
      ],
      [],
    );
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const tree = await readOutlineTree(res.value);
    expect(tree.map((n) => n.title)).toEqual(['第1章', '第2章']);
    expect(tree[0]!.children.map((n) => n.title)).toEqual(['1.1', '1.2']);
    expect(tree[1]!.children).toEqual([]);
  });

  it('annotationIdが無いブックマークは/Fitでページ全体を指す', async () => {
    const src = await buildTestPdfSrc(1, [300, 300]);
    const res = await embedBookmarksIntoPdf(src, [bm('a', 'ページ1', 1)], []);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const [node] = await readOutlineTree(res.value);
    expect(node?.dest[1]?.toString()).toBe('/Fit');
  });

  it('annotationIdを持つブックマークは、アノテーションの左上を/XYZで指す', async () => {
    const src = await buildTestPdfSrc(1, [300, 300]);
    const annotInfo = { style: buildBoxAnnotation(1), context: {} };
    const res = await embedBookmarksIntoPdf(
      src,
      [bm('a', '注釈', 1, { annotationId: TEST_ANNOTATION_ID })],
      [annotInfo],
    );
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const [node] = await readOutlineTree(res.value);
    expect(node?.dest[1]?.toString()).toBe('/XYZ');
    // boundingBox()はBOUNDING_BOX_PADDING(=2)分だけ広げた矩形を返すため、
    // x=10,y=10,width=50,height=30 → (8,8)-(62,42) / ページ高さ300 → 左上 = (8, 292)
    expect((node?.dest[2] as PDFNumber).asNumber()).toBe(8);
    expect((node?.dest[3] as PDFNumber).asNumber()).toBe(292);
  });

  it('ページ範囲外を指すブックマークは書き込み対象から除外される', async () => {
    const src = await buildTestPdfSrc(1, [300, 300]);
    const res = await embedBookmarksIntoPdf(src, [bm('a', '範囲外', 99)], []);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const tree = await readOutlineTree(res.value);
    expect(tree).toEqual([]);
  });

  it('ブックマークが0件の場合は/Outlinesを作成しない', async () => {
    const src = await buildTestPdfSrc(1, [300, 300]);
    const res = await embedBookmarksIntoPdf(src, [], []);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const doc = await loadTestPdf(res.value);
    expect(doc.catalog.get(PDFName.of('Outlines'))).toBeUndefined();
  });

  it('/Countは直接の子だけでなく、開いた状態で表示される子孫の総数を反映する', async () => {
    // root > child > grandchildの3階層構造で、各ノードの/Countが直接の子の数（バグ時の値）
    // ではなく、そのノード配下の子孫の総数になっていることを検証する
    const src = await buildTestPdfSrc(1, [300, 300]);
    const res = await embedBookmarksIntoPdf(
      src,
      [
        bm('root', '第1章', 1),
        bm('child', '1.1', 1, { parentId: 'root' as BookmarkID }),
        bm('grandchild', '1.1.1', 1, { parentId: 'child' as BookmarkID }),
      ],
      [],
    );
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const doc = await loadTestPdf(res.value);
    const outlinesRef = doc.catalog.get(PDFName.of('Outlines')) as PDFRef;
    const outlines = doc.context.lookup(outlinesRef, PDFDict);
    const readCount = (dict: PDFDict) =>
      (dict.get(PDFName.of('Count')) as unknown as PDFNumber).asNumber();

    // Outlines直下の/Countは木全体（root, child, grandchildの3件）の総数
    expect(readCount(outlines)).toBe(3);

    const rootRef = outlines.get(PDFName.of('First')) as PDFRef;
    const rootDict = doc.context.lookup(rootRef, PDFDict);
    // rootの/Countは自分自身を含まない子孫の総数（child, grandchildの2件）
    expect(readCount(rootDict)).toBe(2);

    const childRef = rootDict.get(PDFName.of('First')) as PDFRef;
    const childDict = doc.context.lookup(childRef, PDFDict);
    // childの/Countは自分自身を含まない子孫の総数（grandchildの1件）
    expect(readCount(childDict)).toBe(1);
  });
});

/**
 * pdfjs-distが同梱するテスト用フォントのバイト列を取得する
 *
 * node_modules配下の相対パスをハードコードすると、パッケージマネージャのレイアウト
 * （hoisting、pnpmのsymlink等）やpdfjs-distのバージョン更新で解決に失敗しうるため、
 * パッケージ解決APIで実体を辿る。読み込みに失敗した場合はnullを返し、呼び出し側で
 * 該当テストをスキップする
 */
function tryLoadLiberationSansBytes(): Uint8Array | null {
  try {
    const fontPath = path.join(
      path.dirname(require.resolve('pdfjs-dist/package.json')),
      'standard_fonts/LiberationSans-Regular.ttf',
    );
    return readFileSync(fontPath);
  } catch {
    return null;
  }
}

const LIBERATION_SANS_BYTES = tryLoadLiberationSansBytes();

describe('OSフォント（Local Font Access API）による実フォント埋め込み', () => {
  // bunのテスト環境にはbrowserの`window`が存在しないため、queryLocalFonts差し替え用に
  // 最小限のグローバルを用意する。元から存在した`window`・`queryLocalFonts`は変更しないよう、
  // このブロックで新規作成した場合のみ、各テスト後に`queryLocalFonts`を元の状態へ戻し、
  // スイート終了後に`window`自体を取り除く
  const windowCreatedBySuite = typeof globalThis.window === 'undefined';
  if (windowCreatedBySuite) {
    (globalThis as unknown as { window: unknown }).window = globalThis;
  }
  const originalQueryLocalFonts = window.queryLocalFonts;

  afterEach(() => {
    if (originalQueryLocalFonts === undefined) {
      Reflect.deleteProperty(window, 'queryLocalFonts');
    } else {
      window.queryLocalFonts = originalQueryLocalFonts;
    }
  });

  afterAll(() => {
    if (windowCreatedBySuite) {
      Reflect.deleteProperty(globalThis, 'window');
    }
  });

  describe.skipIf(LIBERATION_SANS_BYTES === null)('実フォントが検出できる場合', () => {
    // skipIfにより、このブロックが実行される時点でLIBERATION_SANS_BYTESは非nullであることが保証されている
    const fontBytes = LIBERATION_SANS_BYTES!;

    it('window.queryLocalFontsが一致するOSフォントを返す場合、標準14フォントではなく実フォントを埋め込む', async () => {
      window.queryLocalFonts = () =>
        Promise.resolve([
          {
            postscriptName: 'LiberationSans-Regular',
            fullName: 'Liberation Sans',
            family: 'Liberation Sans',
            style: 'Regular',
            blob: () => Promise.resolve(new Blob([Uint8Array.from(fontBytes)])),
          },
        ]);

      const src = await buildTestPdfSrc(1, [300, 300]);
      const osFontText = {
        ...buildTextAnnotation(1),
        text: 'Hello',
        fontFamily: 'Liberation Sans',
      };
      const res = await embedAnnotationsAsVectorIntoPdf(src, [osFontText]);
      expect(res.ok).toBeTrue();
      if (!res.ok) return;

      const doc = await loadTestPdf(res.value);
      const fontDict = doc.getPage(0).node.Resources()?.lookup(PDFName.of('Font'), PDFDict);
      expect(fontDict).toBeDefined();
      const [fontRef] = fontDict!.values();
      const embeddedFont = doc.context.lookup(fontRef, PDFDict);
      // 標準14フォント（Type1・FontFileなし）ではなく、実フォントプログラムを含む
      // 埋め込み済みフォント（Type0/CIDFontType2、FontDescriptor経由でFontFile2を持つ）であること
      expect(embeddedFont.get(PDFName.of('Subtype'))?.toString()).toBe('/Type0');
      const [descendantRef] = embeddedFont
        .lookup(PDFName.of('DescendantFonts'), PDFArray)
        .asArray();
      const descendantDict = doc.context.lookup(descendantRef, PDFDict);
      const fontDescriptor = descendantDict.lookup(PDFName.of('FontDescriptor'), PDFDict);
      expect(fontDescriptor.has(PDFName.of('FontFile2'))).toBeTrue();
    });
  });

  it('window.queryLocalFontsが一致するフォントを返さない場合は標準14フォントへフォールバックする', async () => {
    window.queryLocalFonts = () => Promise.resolve([]);

    const src = await buildTestPdfSrc(1, [300, 300]);
    const osFontText = {
      ...buildTextAnnotation(1),
      text: 'Hello',
      fontFamily: 'Nonexistent Font',
    };
    const res = await embedAnnotationsAsVectorIntoPdf(src, [osFontText]);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const doc = await loadTestPdf(res.value);
    const fontDict = doc.getPage(0).node.Resources()?.lookup(PDFName.of('Font'), PDFDict);
    expect(fontDict).toBeDefined();
    const [fontRef] = fontDict!.values();
    const embeddedFont = doc.context.lookup(fontRef, PDFDict);
    expect(embeddedFont.get(PDFName.of('Subtype'))?.toString()).toBe('/Type1');
  });

  describe.skipIf(LIBERATION_SANS_BYTES === null)('汎用フォント名（sans-serif等）の場合', () => {
    const fontBytes = LIBERATION_SANS_BYTES!;

    it('候補名リストに一致するOSフォントが見つかった場合、標準14フォントではなく実フォントを埋め込む', async () => {
      // 'Arial'はsans-serifの候補名リストに含まれているため、これが一致する
      window.queryLocalFonts = () =>
        Promise.resolve([
          {
            postscriptName: 'LiberationSans-Regular',
            fullName: 'Liberation Sans',
            family: 'Arial',
            style: 'Regular',
            blob: () => Promise.resolve(new Blob([Uint8Array.from(fontBytes)])),
          },
        ]);

      const src = await buildTestPdfSrc(1, [300, 300]);
      const genericFontText = {
        ...buildTextAnnotation(1),
        text: 'Hello',
        fontFamily: 'sans-serif',
      };
      const res = await embedAnnotationsAsVectorIntoPdf(src, [genericFontText]);
      expect(res.ok).toBeTrue();
      if (!res.ok) return;

      const doc = await loadTestPdf(res.value);
      const fontDict = doc.getPage(0).node.Resources()?.lookup(PDFName.of('Font'), PDFDict);
      expect(fontDict).toBeDefined();
      const [fontRef] = fontDict!.values();
      const embeddedFont = doc.context.lookup(fontRef, PDFDict);
      expect(embeddedFont.get(PDFName.of('Subtype'))?.toString()).toBe('/Type0');
      const [descendantRef] = embeddedFont
        .lookup(PDFName.of('DescendantFonts'), PDFArray)
        .asArray();
      const descendantDict = doc.context.lookup(descendantRef, PDFDict);
      const fontDescriptor = descendantDict.lookup(PDFName.of('FontDescriptor'), PDFDict);
      expect(fontDescriptor.has(PDFName.of('FontFile2'))).toBeTrue();
    });
  });

  it('汎用フォント名で候補名リストに一致するOSフォントが無い場合は標準14フォントへフォールバックする', async () => {
    window.queryLocalFonts = () =>
      Promise.resolve([
        {
          postscriptName: 'SomeOther-Regular',
          fullName: 'Some Other Font',
          family: 'Some Other Font',
          style: 'Regular',
          blob: () => Promise.resolve(new Blob([])),
        },
      ]);

    const src = await buildTestPdfSrc(1, [300, 300]);
    const genericFontText = {
      ...buildTextAnnotation(1),
      text: 'Hello',
      fontFamily: 'sans-serif',
    };
    const res = await embedAnnotationsAsVectorIntoPdf(src, [genericFontText]);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const doc = await loadTestPdf(res.value);
    const fontDict = doc.getPage(0).node.Resources()?.lookup(PDFName.of('Font'), PDFDict);
    expect(fontDict).toBeDefined();
    const [fontRef] = fontDict!.values();
    const embeddedFont = doc.context.lookup(fontRef, PDFDict);
    expect(embeddedFont.get(PDFName.of('Subtype'))?.toString()).toBe('/Type1');
  });

  describe.skipIf(LIBERATION_SANS_BYTES === null)(
    '汎用フォント名で候補名がOSのロケールにより一致しない場合',
    () => {
      const fontBytes = LIBERATION_SANS_BYTES!;

      it('候補名リストに一致しなくても、対象テキストのグリフを実際に持つ他のOSフォントへ最終手段としてフォールバックする', async () => {
        // 候補名リスト（英語名）のどれとも一致しない名前（ローカライズされたフォント名を想定）
        // だが、対象テキストのグリフは実際に持っているフォントとして振る舞わせる
        window.queryLocalFonts = () =>
          Promise.resolve([
            {
              postscriptName: 'LiberationSans-Regular',
              fullName: 'ローカライズされたフォント名',
              family: 'ローカライズされたフォント名',
              style: 'Regular',
              blob: () => Promise.resolve(new Blob([Uint8Array.from(fontBytes)])),
            },
          ]);

        const src = await buildTestPdfSrc(1, [300, 300]);
        const genericFontText = {
          ...buildTextAnnotation(1),
          text: 'Hello',
          fontFamily: 'sans-serif',
        };
        const res = await embedAnnotationsAsVectorIntoPdf(src, [genericFontText]);
        expect(res.ok).toBeTrue();
        if (!res.ok) return;

        const doc = await loadTestPdf(res.value);
        const fontDict = doc.getPage(0).node.Resources()?.lookup(PDFName.of('Font'), PDFDict);
        expect(fontDict).toBeDefined();
        const [fontRef] = fontDict!.values();
        const embeddedFont = doc.context.lookup(fontRef, PDFDict);
        // 候補名一致ではなく、グリフの実収録有無で見つけた実フォントが埋め込まれていること
        expect(embeddedFont.get(PDFName.of('Subtype'))?.toString()).toBe('/Type0');
      });
    },
  );

  describe('anyTextWillFallbackToStandardFont（フォント埋め込みリスク判定の実体）', () => {
    it('OSフォントが0件の場合はフォールバックすると判定する', async () => {
      window.queryLocalFonts = () => Promise.resolve([]);

      const result = await anyTextWillFallbackToStandardFont([
        { fontFamily: 'sans-serif', fontWeight: 400, text: 'こんにちは' },
      ]);
      expect(result).toBeTrue();
    });

    it('OSフォントが1件でもあるだけでは、対象文字を収録していなければフォールバックすると判定する', async () => {
      // 候補名にもファミリー名にも一致しない、対象テキストのグリフも持たない無関係なフォントのみ
      window.queryLocalFonts = () =>
        Promise.resolve([
          {
            postscriptName: 'SomeOther-Regular',
            fullName: 'Some Other Font',
            family: 'Some Other Font',
            style: 'Regular',
            blob: () => Promise.resolve(new Blob([])),
          },
        ]);

      // OSフォントが1件でも取得できることをもって「安全」と誤判定しないことを確認する
      // （フォント一覧の件数だけでなく、保存処理と同じグリフ収録判定を経由すること）
      const result = await anyTextWillFallbackToStandardFont([
        { fontFamily: 'sans-serif', fontWeight: 400, text: 'こんにちは' },
      ]);
      expect(result).toBeTrue();
    });

    describe.skipIf(LIBERATION_SANS_BYTES === null)('対象文字を実際に収録するOSフォントがある場合', () => {
      const fontBytes = LIBERATION_SANS_BYTES!;

      it('フォールバックしないと判定する', async () => {
        window.queryLocalFonts = () =>
          Promise.resolve([
            {
              postscriptName: 'LiberationSans-Regular',
              fullName: 'Liberation Sans',
              family: 'Liberation Sans',
              style: 'Regular',
              blob: () => Promise.resolve(new Blob([Uint8Array.from(fontBytes)])),
            },
          ]);

        const result = await anyTextWillFallbackToStandardFont([
          { fontFamily: 'Liberation Sans', fontWeight: 400, text: 'Hello' },
        ]);
        expect(result).toBeFalse();
      });
    });
  });
});
