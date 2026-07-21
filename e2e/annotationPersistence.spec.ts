import {
  test,
  expect,
  openDemoDocument,
  stageCanvas,
  toolButton,
  dragDrawAt,
  DEMO_FIRST_FILE_NAME,
} from './fixtures/demoContainer';

/**
 * アノテーションの永続化（IndexedDBへの保存）を確認するE2Eテスト
 *
 * 作成したアノテーションが、タブを閉じて同じ文書を開き直した後も残っていることを検証する
 */

test('作成したアノテーションはタブを閉じて再度開いても保持される', async ({ page }) => {
  await openDemoDocument(page);

  await toolButton(page, 'annotation-box').click();
  const { centerX, centerY } = await dragDrawAt(page, stageCanvas(page), 0.85, 0.85);

  await toolButton(page, 'select-mode').click();
  await page.mouse.click(centerX, centerY);
  await expect(page.locator('.annotation-properties .property-value')).toHaveText('box');

  // 保存を待ってからタブを閉じる（自動保存はデバウンスされるため）
  await page.waitForTimeout(1500);

  const tabItem = page.locator('.tab-item', { hasText: DEMO_FIRST_FILE_NAME });
  await tabItem.hover();
  await tabItem.locator('.tab-close-btn').click();
  await expect(tabItem).toHaveCount(0);

  const fileEntry = page.locator('.exp-file', { hasText: DEMO_FIRST_FILE_NAME });
  await fileEntry.click();
  await expect(stageCanvas(page)).toBeVisible();

  await toolButton(page, 'select-mode').click();
  await page.mouse.click(centerX, centerY);

  await expect(page.locator('.annotation-properties .property-value')).toHaveText('box');
});
