import { beforeAll, describe, expect, test } from 'bun:test';
import { Image2Text, initOCR } from '../main';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { JSDOM } from 'jsdom';
import { createCanvas, Image } from 'canvas';

const OCRASSESTS_DIR = join(import.meta.dir, 'ocrAssets');

function browserEnvSetup() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');

  // グローバルにブラウザ環境を注入
  global.window = dom.window as unknown as Window & typeof globalThis;
  global.document = dom.window.document;
  global.navigator = dom.window.navigator;
  global.HTMLCanvasElement = dom.window.HTMLCanvasElement;

  // Canvas実装をNode.jsから持ってくる
  global.document.createElement = (tagName: string) => {
    if (tagName === 'canvas') {
      return createCanvas(100, 100) as unknown as HTMLCanvasElement;
    }
    return dom.window.document.createElement(tagName);
  };
  global.Image = Image as unknown as { new (width?: number, height?: number): HTMLImageElement };
}

/** 処理時間短縮のためにOCRプロセスを初期化しておく */
beforeAll(async () => {
  await initOCR()
}, { timeout: 10 * 10**3 })

/**
 * ocrAssetsフォルダから画像ファイルを読み込んでOCR結果を検証するテスト
 * 画像ファイルと対応する期待テキストファイル（.txt）が必要
 * 例：image.png と image.txt
 */
describe('ocr tests', () => {
  // ブラウザ環境を注入
  browserEnvSetup();

  // ocrAssetsフォルダから画像ファイルを取得
  const files = readdirSync(OCRASSESTS_DIR);
  const imageFiles = files.filter(
    (file) => file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg'),
  );

  // テスト対象の画像ファイルがない場合はスキップ
  if (imageFiles.length === 0) {
    throw new Error('No image files found in ocrAssets folder. Please add test images.');
  }

  // 各画像ファイルについてOCRを実行し、期待値と比較
  test.each(imageFiles)('simple images to ocr (%s)', async (imageFile) => {
    const imagePath = join(OCRASSESTS_DIR, imageFile);
    const expectedTextPath = imagePath.replace(/\.(png|jpg|jpeg)$/i, '.txt');

    // 期待テキストファイルが存在するか確認
    let expectedText: string | null = null;
    try {
      expectedText = readFileSync(expectedTextPath, 'utf-8').trim();
    } catch {
      throw new Error(`Expected text file not found for ${imageFile}.`);
    }

    // OCRを実行
    const ocrResult = await Image2Text(imagePath);
    const normalizedOcrResult = ocrResult.trim();

    // 結果を比較
    expect(normalizedOcrResult).toBe(expectedText);
  });
});
