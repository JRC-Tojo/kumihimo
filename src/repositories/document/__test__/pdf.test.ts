import { describe, expect, it } from 'bun:test';
import type { PDFDocumentProxy } from 'pdfjs-dist';

// pdfjs-distはモジュール読み込み時（トップレベル）に`new DOMMatrix()`を評価するため、
// DOMのないbunテスト環境ではimportするだけで`ReferenceError`になる。実際にレンダリング系の
// 機能（Canvas描画等）は本テストの経路では呼ばれないため、コンストラクタが例外を投げない
// 最小限のスタブで十分。動的importの前に登録する必要があるためトップレベルawaitを使う
if (typeof globalThis.DOMMatrix === 'undefined') {
  (globalThis as unknown as { DOMMatrix: unknown }).DOMMatrix = class {};
}

const { extractTextBlocksByPageFromDoc } = await import('../pdf');

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

describe('extractTextBlocksByPageFromDoc（pdfItemToBox）', () => {
  it('回転無し（0度）のページでは、ベースライン位置からwidth/heightそのままの矩形になる', async () => {
    const res = await extractTextBlocksByPageFromDoc(buildFakePdf(0), 1);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    expect(res.value).toHaveLength(1);
    expect(res.value[0]).toEqual({ text: 'AB', x: 50, y: 68, width: 30, height: 12 });
  });

  it('90度回転したページでは、width/heightが入れ替わった矩形になる（回転を考慮しない実装では検知できない回帰）', async () => {
    const res = await extractTextBlocksByPageFromDoc(buildFakePdf(90), 1);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    expect(res.value).toHaveLength(1);
    expect(res.value[0]).toEqual({ text: 'AB', x: 20, y: 50, width: 12, height: 30 });
  });

  it('270度回転したページでも、90度と同様にwidth/heightが入れ替わった矩形になる', async () => {
    const res = await extractTextBlocksByPageFromDoc(buildFakePdf(270), 1);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    expect(res.value).toHaveLength(1);
    expect(res.value[0]?.width).toBe(12);
    expect(res.value[0]?.height).toBe(30);
  });
});
