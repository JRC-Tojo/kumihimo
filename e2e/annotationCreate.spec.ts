import {
  test,
  expect,
  openDemoDocument,
  stageCanvas,
  toolButton,
  dragDrawAt,
} from './fixtures/demoContainer';

/**
 * アノテーション作成機能のE2Eテスト
 *
 * ドラッグ型（矩形）・クリック頂点型（ポリゴン）それぞれの作成を検証する。
 * Konvaのシェイプ自体はDOM要素化されないため、作成後にselect-modeへ切り替えて
 * 同じ座標をクリックし、右ドレワーのプロパティパネルで種別を確認する
 */

test.beforeEach(async ({ page }) => {
  await openDemoDocument(page);
});

test('矩形アノテーションをドラッグで作成できる', async ({ page }) => {
  const canvas = stageCanvas(page);

  await toolButton(page, 'annotation-box').click();
  const { centerX, centerY } = await dragDrawAt(page, canvas, 0.85, 0.85);

  await toolButton(page, 'select-mode').click();
  await page.mouse.click(centerX, centerY);

  await expect(page.locator('.annotation-properties .property-value')).toHaveText('box');
});

test('ポリゴンアノテーションをクリックで作成できる', async ({ page }) => {
  const canvas = stageCanvas(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('ステージのcanvasが見つかりません');

  const p1 = { x: box.x + box.width * 0.8, y: box.y + box.height * 0.8 };
  const p2 = { x: box.x + box.width * 0.9, y: box.y + box.height * 0.8 };
  const p3 = { x: box.x + box.width * 0.85, y: box.y + box.height * 0.9 };

  await toolButton(page, 'annotation-polygon').click();
  await page.mouse.click(p1.x, p1.y);
  await page.mouse.click(p2.x, p2.y);
  await page.mouse.dblclick(p3.x, p3.y);

  const centroid = {
    x: (p1.x + p2.x + p3.x) / 3,
    y: (p1.y + p2.y + p3.y) / 3,
  };

  await toolButton(page, 'select-mode').click();
  await page.mouse.click(centroid.x, centroid.y);

  await expect(page.locator('.annotation-properties .property-value')).toHaveText('polygon');
});
