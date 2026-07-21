import {
  test,
  expect,
  openDemoDocument,
  stageCanvas,
  toolButton,
  dragDrawAt,
} from './fixtures/demoContainer';

/**
 * アノテーション編集機能（スタイル変更・位置サイズ変更）のE2Eテスト
 */

test.beforeEach(async ({ page }) => {
  await openDemoDocument(page);

  await toolButton(page, 'annotation-box').click();
  const { centerX, centerY } = await dragDrawAt(page, stageCanvas(page), 0.8, 0.8, 80, 60);
  await toolButton(page, 'select-mode').click();
  await page.mouse.click(centerX, centerY);
  await expect(page.locator('.annotation-properties .property-value')).toHaveText('box');
});

test('位置・サイズパネルで幅を変更できる', async ({ page }) => {
  const positionSizeBtn = page.locator('.style-icon-btn', {
    has: page.locator('i:text-is("crop_free")'),
  });
  await positionSizeBtn.click();

  const widthInput = page
    .locator('.position-size-row')
    .nth(1)
    .locator('.position-size-input input')
    .nth(0);
  await expect(widthInput).toBeVisible();

  const originalWidth = Number(await widthInput.inputValue());
  const newWidth = originalWidth + 50;

  await widthInput.fill(String(newWidth));
  await widthInput.blur();

  // メニューを閉じて開き直し、変更が保持されていることを確認する
  await page.keyboard.press('Escape');
  await positionSizeBtn.click();

  const widthInputAfterReopen = page
    .locator('.position-size-row')
    .nth(1)
    .locator('.position-size-input input')
    .nth(0);
  await expect(widthInputAfterReopen).toHaveValue(String(newWidth));
});

test('スタイルパネルで線幅を変更できる', async ({ page }) => {
  const strokeWidthBtn = page.locator('.style-value-btn').nth(0);
  const before = await strokeWidthBtn.locator('.style-value-text').innerText();

  await strokeWidthBtn.click();
  const slider = page.locator('.style-value-menu [role="slider"]').first();
  await slider.focus();
  for (let i = 0; i < 5; i++) {
    await slider.press('ArrowRight');
  }
  await page.keyboard.press('Escape');

  const after = await strokeWidthBtn.locator('.style-value-text').innerText();
  expect(after).not.toBe(before);
});
