import { describe, expect, it } from 'bun:test';
import { JSDOM } from 'jsdom';
import { createCanvas } from 'canvas';
import { deskew } from '../main';

/**
 * `ocr.test.ts`のbrowserEnvSetup()と同じパターン。deskewは実OCRモデルに依存しない
 * 純粋なCanvas処理のため、モデル初期化（initOCR、beforeAllで20秒のタイムアウトを要する）を
 * 避けてこのファイルを独立させている
 */
function browserEnvSetup(): void {
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

describe('deskew（Issue #110: 輝度ベースの黒画素判定）', () => {
  browserEnvSetup();

  it('黒い斜め線は傾きが検出され、Canvasサイズが回転後のものへ変わる', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 60;
    canvas.height = 20;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context is not available');

    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 60, 20);
    ctx.strokeStyle = 'rgb(0,0,0)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(5, 15);
    ctx.lineTo(55, 5);
    ctx.stroke();

    deskew(ctx);

    expect(canvas.width !== 60 || canvas.height !== 20).toBeTrue();
  });

  it('赤色の斜め線（Rチャンネルは255だが輝度は暗い）でも黒画素として検出し、傾きを補正する', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 60;
    canvas.height = 20;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context is not available');

    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 60, 20);
    ctx.strokeStyle = 'rgb(255,0,0)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(5, 15);
    ctx.lineTo(55, 5);
    ctx.stroke();

    deskew(ctx);

    // 輝度ベース（0.299R+0.587G+0.114B）なら赤（255,0,0）は輝度約76で「黒画素」として
    // 検出され、傾き角度が算出されてCanvasが回転後のサイズへ変更される。
    // Rチャンネルのみで判定していた旧実装では赤は常に除外され、モーメントm00が0のまま
    // 早期returnしていたため、このアサーションは旧実装では失敗する（サイズが変わらない）
    expect(canvas.width !== 60 || canvas.height !== 20).toBeTrue();
  });

  it('全体が白い（暗いピクセルが無い）Canvasは何も変更しない', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 30;
    canvas.height = 30;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context is not available');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 30, 30);

    deskew(ctx);

    expect(canvas.width).toBe(30);
    expect(canvas.height).toBe(30);
  });
});
