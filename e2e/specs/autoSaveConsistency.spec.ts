import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  buildBoxAnnotationStyle,
  registerAnnotation,
  seedCacheContainerWithFixturePdf,
} from '../support/seed';
import { docPointToPagePosition, stageCanvas, waitForCanvasReady } from '../support/canvasCoords';
import type { TestContainerFile } from '../support/testHook';

const PAGE_SIZE = { width: 400, height: 300 };
const idA = '55555555-5555-4555-8555-555555555555';

async function openFileInSelectMode(page: Page, containerName: string): Promise<Locator> {
  await page.locator('.exp-container-row .container-name', { hasText: containerName }).click();
  await page.locator('.exp-file .file-name').first().click();
  await page.locator('[data-testid="select-mode"]').click();

  const canvas = stageCanvas(page);
  await waitForCanvasReady(canvas);
  return canvas;
}

async function positionOfA(page: Page, file: TestContainerFile) {
  const res = await page.evaluate(async (file: TestContainerFile) => {
    const api = window.__kumihimoTest?.api;
    if (!api) throw new Error('__kumihimoTest hook is not available');
    return api.getAnnotationsByFile(file);
  }, file);
  if (!res.ok) return undefined;
  const style = (res.data ?? []).find((info) => info.style.id === idA)?.style;
  if (!style) return undefined;
  return { x: style.x as number, y: style.y as number };
}

test.describe('自動保存の整合性', () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  /**
   * `.kcfg`書き込み（グループ化・ブックマーク登録等）と自動保存が並行して発生した際、
   * `updateConfig`の内部読み込みが`.kcfg`の古いannotsスナップショットでDBを巻き戻して
   * しまっていた回帰（`config.ts`の`loadConfigRaw`/`loadConfigWithSideEffects`分離で修正）の
   * 確認。自動保存を有効にした状態でアノテーションを移動し、デバウンス（1.5秒）を複数回
   * またぐ間、移動後の位置が一度も移動前の位置へ巻き戻らないことを検証する
   */
  test('自動保存が有効な状態でアノテーションを移動しても、複数回の自動保存をまたいで位置が巻き戻らない', async ({
    page,
  }) => {
    const seeded = await seedCacheContainerWithFixturePdf(page, {
      containerName: 'autosave-no-rollback',
    });
    await registerAnnotation(
      page,
      seeded.file,
      buildBoxAnnotationStyle({ id: idA, pageNumber: 1, x: 30, y: 30, width: 40, height: 30 }),
    );

    const canvas = await openFileInSelectMode(page, 'autosave-no-rollback');

    // 移動前に一度明示的に保存し、`.kcfg`に移動前の位置を確定させておく（そうしないと、
    // 自動保存の内部読み込みが巻き戻す先の「.kcfgに記録された古い位置」がそもそも存在せず、
    // このテストが不具合を検出できない）
    await page.getByRole('button', { name: 'Save Changes' }).click();

    // 自動保存をオンにする
    await page.getByRole('switch', { name: '自動保存' }).click();

    const before = await positionOfA(page, seeded.file);
    expect(before).toBeDefined();

    const center = await docPointToPagePosition(canvas, { x: 50, y: 45 }, PAGE_SIZE);
    const dragTo = { x: center.x + 60, y: center.y + 40 };
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(dragTo.x, dragTo.y, { steps: 8 });
    await page.mouse.up();

    // 移動後の位置が確定するまで待つ
    let after: { x: number; y: number } | undefined;
    await expect
      .poll(async () => {
        after = await positionOfA(page, seeded.file);
        return after !== undefined && (after.x !== before?.x || after.y !== before?.y);
      })
      .toBe(true);

    // 自動保存のデバウンス（1.5秒）を2回以上またぐ間、250ms間隔で位置をサンプリングし、
    // 一度でも移動前の位置に戻っていないかを確認する
    const samples: { x: number; y: number }[] = [];
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const pos = await positionOfA(page, seeded.file);
      if (pos) samples.push(pos);
      await page.waitForTimeout(250);
    }

    expect(samples.length).toBeGreaterThan(0);
    for (const sample of samples) {
      expect(sample).toEqual(after);
    }
  });
});
