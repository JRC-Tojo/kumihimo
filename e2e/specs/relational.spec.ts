import { expect, test } from '@playwright/test';
import { registerAnnotation, seedCacheContainerWithFixturePdf } from '../support/seed';
import { docPointToPagePosition, stageCanvas, waitForCanvasReady } from '../support/canvasCoords';

const PAGE_SIZE = { width: 400, height: 300 };
const SRC_ID = '33333333-3333-4333-8333-333333333333';
const TARGET_ID = '44444444-4444-4444-8444-444444444444';

/** テスト用のboxアノテーションスタイルオブジェクトを組み立てる（pdf.test.tsのbuildAnnotationBaseと同じ形） */
function buildBoxStyle(id: string, x: number, y: number) {
  const now = new Date().toISOString();
  return {
    id,
    type: 'box',
    pageNumber: 1,
    x,
    y,
    width: 50,
    height: 30,
    color: '#0000ff',
    strokeWidth: 2,
    strokeType: 'solid' as const,
    createdAt: now,
    updatedAt: now,
    comment: {},
  };
}

test.describe('関係性機能', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  /**
   * 2つのアノテーションを順に選択して「等しい」でペアリングすると、関係性が実際に登録され、
   * かつ対象シェイプの見た目（検証状態の枠色）が変化することを検証する
   */
  test('2つのアノテーションを選択してペアリングすると、関係性が登録され見た目が変化する', async ({
    page,
  }) => {
    const seeded = await seedCacheContainerWithFixturePdf(page, { containerName: 'rel-pair' });
    await registerAnnotation(page, seeded.file, buildBoxStyle(SRC_ID, 40, 40));
    await registerAnnotation(page, seeded.file, buildBoxStyle(TARGET_ID, 250, 200));

    await page.locator('.exp-container-row .container-name', { hasText: 'rel-pair' }).click();
    await page.locator('.exp-file .file-name', { hasText: seeded.file.path }).click();
    await page.locator('[data-testid="select-mode"]').click();

    const canvas = stageCanvas(page);
    await waitForCanvasReady(canvas);
    const beforePair = await canvas.screenshot();

    // 1つめのアノテーションを選択 -> 「等しい」を1クリックしてペアリング待機状態にする
    const srcPos = await docPointToPagePosition(canvas, { x: 65, y: 55 }, PAGE_SIZE);
    await page.mouse.click(srcPos.x, srcPos.y);

    await expect(page.locator('[data-testid^="relational-define-"]').first()).toBeVisible();
    await page.locator('[data-testid="relational-define-equal"]').click();

    // 2つめのアノテーションを選択するとペアが確定する
    const targetPos = await docPointToPagePosition(canvas, { x: 275, y: 215 }, PAGE_SIZE);
    await page.mouse.click(targetPos.x, targetPos.y);

    // ペアリングの成立自体は、OCR結果に依存しないRelationalレコードの有無で検証する
    // （OK/NG判定はOCR完了後の非同期処理に依存するため、ここでは対象としない。
    //   ロジック自体はdecideRelationalOnAnnotationsAdded等で別途単体テスト済み）
    await expect
      .poll(
        async () =>
          page.evaluate(async (file) => {
            const api = window.__kumihimoTest?.api;
            if (!api) throw new Error('__kumihimoTest hook is not available');
            const res = await api.getRelationalsInFile(file);
            return res.ok ? (res.data?.length ?? 0) : -1;
          }, seeded.file),
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);

    // 関係性が確定すると、対象シェイプに検証状態の枠色が付与され見た目が変化する
    // （具体的な色決定ロジックはrelationalStyleOverride.test.tsで検証済みのため、ここでは
    //   「画面上で何らかの視覚変化が実際に起きるか」のみを見る）
    await expect
      .poll(
        async () => {
          const afterPair = await canvas.screenshot();
          return Buffer.compare(beforePair, afterPair) !== 0;
        },
        { timeout: 10_000 },
      )
      .toBe(true);
  });
});
