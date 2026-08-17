import { expect, test } from '@playwright/test';
import { registerAnnotation, seedCacheContainerWithFixturePdf } from '../support/seed';
import { docPointToPagePosition, stageCanvas } from '../support/canvasCoords';

const PAGE_SIZE = { width: 400, height: 300 };

test.describe('アノテーション操作', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('boxツールで描画すると、キャンバス上に矩形アノテーションが表示される', async ({ page }) => {
    const seeded = await seedCacheContainerWithFixturePdf(page, { containerName: 'annot-draw' });

    await page.locator('.exp-container-row .container-name', { hasText: 'annot-draw' }).click();
    await page.locator('.exp-file .file-name', { hasText: seeded.file.path }).click();

    await page.locator('[data-testid="annotation-box"]').click();

    const canvas = stageCanvas(page);
    await expect(canvas).toBeVisible();

    const start = await docPointToPagePosition(canvas, { x: 40, y: 40 }, PAGE_SIZE);
    const end = await docPointToPagePosition(canvas, { x: 160, y: 120 }, PAGE_SIZE);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();

    // Konvaはシェイプ単位のDOM要素を持たないため、描画結果はcanvasの見た目
    // （スクリーンショット）で検証する。ロジック（座標変換式そのもの）はannotationGeometry.test.tsで
    // 別途検証済みのため、ここでは「実際に操作して見た目に矩形が現れるか」のみを見る
    await expect(canvas).toHaveScreenshot('box-drawn.png', { maxDiffPixelRatio: 0.02 });
  });

  test('既存アノテーションを選択してドラッグすると、表示上の位置が移動する', async ({ page }) => {
    const seeded = await seedCacheContainerWithFixturePdf(page, {
      containerName: 'annot-drag',
    });
    await registerAnnotation(
      page,
      seeded.file,
      buildBoxStyle('11111111-1111-4111-8111-111111111111', 1, 40, 40),
    );

    await page.locator('.exp-container-row .container-name', { hasText: 'annot-drag' }).click();
    await page.locator('.exp-file .file-name', { hasText: seeded.file.path }).click();

    await page.locator('[data-testid="select-mode"]').click();

    const canvas = stageCanvas(page);
    await expect(canvas).toBeVisible();

    const before = await canvas.screenshot();

    const from = await docPointToPagePosition(canvas, { x: 60, y: 60 }, PAGE_SIZE);
    const to = await docPointToPagePosition(canvas, { x: 200, y: 60 }, PAGE_SIZE);

    // 1回目のmousedown+upで選択、2回目のドラッグで移動（Konvaのdraggable挙動に合わせる）
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();

    const after = await canvas.screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);
  });

  test('アノテーションを右クリックするとコンテキストメニューが表示される', async ({ page }) => {
    const seeded = await seedCacheContainerWithFixturePdf(page, {
      containerName: 'annot-menu',
    });
    await registerAnnotation(
      page,
      seeded.file,
      buildBoxStyle('22222222-2222-4222-8222-222222222222', 1, 40, 40),
    );

    await page.locator('.exp-container-row .container-name', { hasText: 'annot-menu' }).click();
    await page.locator('.exp-file .file-name', { hasText: seeded.file.path }).click();
    await page.locator('[data-testid="select-mode"]').click();

    const canvas = stageCanvas(page);
    const pos = await docPointToPagePosition(canvas, { x: 60, y: 60 }, PAGE_SIZE);
    await page.mouse.click(pos.x, pos.y, { button: 'right' });

    await expect(page.locator('.context-menu-anchor')).toBeVisible();
  });
});

function buildBoxStyle(id: string, pageNumber: number, x: number, y: number) {
  const now = new Date().toISOString();
  return {
    id,
    type: 'box',
    pageNumber,
    x,
    y,
    width: 60,
    height: 40,
    color: '#ff0000',
    strokeWidth: 2,
    strokeType: 'solid' as const,
    createdAt: now,
    updatedAt: now,
    comment: {},
  };
}
