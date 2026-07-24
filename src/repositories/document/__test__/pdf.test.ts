import { describe, expect, it, mock } from 'bun:test';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
import { JSDOM } from 'jsdom';
import { createCanvas } from 'canvas';
import type { TextItemBox, AnnotationStyle } from 'src/models/document/pdf';
import { AnnotationID, ColorCode } from 'src/models/document/pdf';
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
  extractImageFromRegion,
  extractAnnotationContextPreview,
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
});

// ============================================================
// グループB: pdfjs-dist経由（loadPdfFromSrc64ベース、mock.moduleでgetDocumentを差し替える）
// ============================================================

/** loadPdfFromSrc64の呼び出し自体（base64デコード）を通すためだけの、内容を問わないダミーsrc64 */
const DUMMY_SRC = DocumentSource.parse(btoa('dummy-pdf-bytes'));

/** pdfjs-distの`getDocument`モックが返す、テストごとに最小限のメソッドだけを実装したフェイクのPDFDocumentProxy */
function buildFakeDoc(pages: unknown[]): PDFDocumentProxy {
  return {
    numPages: pages.length,
    getPage: (n: number) => Promise.resolve(pages[n - 1]),
    destroy: () => Promise.resolve(),
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
