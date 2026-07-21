import {
  test,
  expect,
  openDemoDocument,
  stageCanvas,
  toolButton,
  dragDrawAt,
} from './fixtures/demoContainer';

/**
 * アノテーション間の関係性（リレーショナル）リンク機能のE2Eテスト
 *
 * 右ドレワーの「Add Relation」から待機モードに入り、次に追加したアノテーションと
 * 自動的にリンクされる（`registRelationalByAdd`、DocumentTabView.vue）挙動を検証する
 */

test('2つのアノテーション間に関係性を作成・削除できる', async ({ page }) => {
  await openDemoDocument(page);
  const canvas = stageCanvas(page);

  // 1つ目のアノテーション（基準側）を作成して選択する
  await toolButton(page, 'annotation-box').click();
  const first = await dragDrawAt(page, canvas, 0.85, 0.85, 60, 40);

  await toolButton(page, 'select-mode').click();
  await page.mouse.click(first.centerX, first.centerY);
  await expect(page.locator('.annotation-properties .property-value')).toHaveText('box');

  // 関係性登録の待機を開始する
  await page.getByRole('button', { name: 'リンクを追加' }).click();

  // 2つ目のアノテーション（対象側）を離れた位置に作成する。待機中に追加されるため自動的にリンクされる
  await toolButton(page, 'annotation-circle').click();
  await dragDrawAt(page, canvas, 0.4, 0.85, 60, 40);

  // 基準側を再選択し、関係性が1件登録されていることを確認する
  await toolButton(page, 'select-mode').click();
  await page.mouse.click(first.centerX, first.centerY);
  await expect(page.locator('.annotation-properties .property-value')).toHaveText('box');

  const relationRows = page.locator('.relation-list .relation-row');
  await expect(relationRows).toHaveCount(1);

  // 関係性を削除する
  await relationRows.first().getByRole('button').click();
  await expect(page.locator('.relation-list .relation-row')).toHaveCount(0);
  await expect(page.getByText('リンクはありません')).toBeVisible();
});
