import {
  test,
  expect,
  openDemoDocument,
  stageCanvas,
  toolButton,
  dragDrawAt,
} from './fixtures/demoContainer';

/**
 * アノテーション削除機能のE2Eテスト
 *
 * 選択中のアノテーションはDeleteキー（グローバルのkeydownリスナー）で削除できる。
 * 削除後は右ドレワーが「未選択」表示に戻ることを確認する
 */

test.beforeEach(async ({ page }) => {
  await openDemoDocument(page);
});

test('選択したアノテーションをDeleteキーで削除できる', async ({ page }) => {
  await toolButton(page, 'annotation-box').click();
  const { centerX, centerY } = await dragDrawAt(page, stageCanvas(page), 0.85, 0.85);

  await toolButton(page, 'select-mode').click();
  await page.mouse.click(centerX, centerY);
  await expect(page.locator('.annotation-properties .property-value')).toHaveText('box');

  await page.keyboard.press('Delete');

  await expect(page.locator('.drawer-empty')).toBeVisible();
  await expect(page.locator('.annotation-properties')).toHaveCount(0);
});

test('右ドレワーの削除ボタンでアノテーションを削除できる', async ({ page }) => {
  await toolButton(page, 'annotation-circle').click();
  const { centerX, centerY } = await dragDrawAt(page, stageCanvas(page), 0.85, 0.6);

  await toolButton(page, 'select-mode').click();
  await page.mouse.click(centerX, centerY);
  await expect(page.locator('.annotation-properties .property-value')).toHaveText('circle');

  await page.getByRole('button', { name: '削除' }).click();

  await expect(page.locator('.drawer-empty')).toBeVisible();
});
