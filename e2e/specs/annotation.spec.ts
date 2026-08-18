import { expect, test } from '@playwright/test';
import { registerAnnotation, seedCacheContainerWithFixturePdf } from '../support/seed';
import { docPointToPagePosition, stageCanvas } from '../support/canvasCoords';

const PAGE_SIZE = { width: 400, height: 300 };

test.describe('アノテーション操作', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  /**
   * boxツールを選択してキャンバス上をドラッグし、矩形アノテーションが実際に描画されることを検証する
   */
  test('boxツールで描画すると、キャンバス上に矩形アノテーションが表示される', async ({ page }) => {
    const seeded = await seedCacheContainerWithFixturePdf(page, { containerName: 'annot-draw' });

    await page.locator('.exp-container-row .container-name', { hasText: 'annot-draw' }).click();
    await page.locator('.exp-file .file-name', { hasText: seeded.file.path }).click();

    await page.locator('[data-testid="annotation-box"]').click();

    const canvas = stageCanvas(page);
    await expect(canvas).toBeVisible();

    const start = await docPointToPagePosition(canvas, { x: 40, y: 40 }, PAGE_SIZE);
    const end = await docPointToPagePosition(canvas, { x: 160, y: 120 }, PAGE_SIZE);

    // Konvaはシェイプ単位のDOM要素を持たないため、描画結果はcanvasの見た目で検証する。
    // 座標変換ロジック自体はannotationGeometry.test.tsで別途検証済みのため、ここでは
    // 「実際に操作して見た目に矩形が現れるか」のみを、描画前後のスクリーンショット差分で見る
    // （固定のベースライン画像は用意していない。環境間の差分許容の調整はフォローアップで対応）
    const before = await canvas.screenshot();

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();

    const after = await canvas.screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);
  });

  /**
   * 既存のboxアノテーションを選択した状態からドラッグすると、その移動分だけキャンバスの
   * 見た目が変化することを検証する（選択自体による見た目の変化と、ドラッグによる移動を
   * 区別するため、スクリーンショットは選択直後・ドラッグ直前を基準にする）
   */
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

    const from = await docPointToPagePosition(canvas, { x: 60, y: 60 }, PAGE_SIZE);
    const to = await docPointToPagePosition(canvas, { x: 200, y: 60 }, PAGE_SIZE);

    // まず選択のみを行う（mousedown+up）。選択ハイライトの表示自体もピクセルを変化させるため、
    // 「選択後・ドラッグ前」の状態を基準スクリーンショットにすることで、後段の差分検証が
    // ドラッグによる移動のみを捉えるようにする（選択のみでも差分が出てしまうと、実際には
    // ドラッグが機能していない回帰があっても見逃してしまう）
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.up();

    const before = await canvas.screenshot();

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();

    const after = await canvas.screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);
  });

  /**
   * 既存アノテーションを右クリックすると、コンテキストメニューが実際に表示されることを検証する
   */
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

    // `.context-menu-anchor`（AnnotationContextMenu.vueが座標指定のためにTeleportする位置決め用の
    // ラッパーdiv）自体は幅・高さを持たないため`toBeVisible()`は常に false になる。実際に見える
    // メニュー本体はQuasarのq-menuが独自にbody配下へポータルするため、そちらを見る必要がある
    await expect(page.getByRole('menu')).toBeVisible();
  });
});

/** テスト用のboxアノテーションスタイルオブジェクトを組み立てる（pdf.test.tsのbuildAnnotationBaseと同じ形） */
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
