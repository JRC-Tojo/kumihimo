import { expect, test } from '@playwright/test';
import { seedCacheContainerWithFixturePdf } from '../support/seed';
import { stageCanvas } from '../support/canvasCoords';

test.describe('PDF文書のレンダリング', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('フィクスチャPDFを開くと、pdf.jsによる実際の描画結果が表示される', async ({ page }) => {
    const seeded = await seedCacheContainerWithFixturePdf(page, { containerName: 'pdf-render' });

    await page.locator('.exp-container-row .container-name', { hasText: 'pdf-render' }).click();
    await page.locator('.exp-file .file-name', { hasText: seeded.file.path }).click();

    const pdfCanvas = page.locator('canvas').first();
    await expect(pdfCanvas).toBeVisible();

    // 実際にpdf.jsがページ内容（フィクスチャPDFの矩形＋テキスト）を描画した結果を検証する。
    // pdfManager.ts自体の座標変換ロジック（回転考慮等）はpdf.test.tsで別途検証済みのため、
    // ここでは「実ブラウザで実際に見た目どおり描画されるか」のみを見る
    await expect(pdfCanvas).toHaveScreenshot('pdf-page1.png', { maxDiffPixelRatio: 0.02 });
  });

  test('2ページ目へ移動すると、そのページの内容が描画される', async ({ page }) => {
    const seeded = await seedCacheContainerWithFixturePdf(page, {
      containerName: 'pdf-page-nav',
    });

    await page.locator('.exp-container-row .container-name', { hasText: 'pdf-page-nav' }).click();
    await page.locator('.exp-file .file-name', { hasText: seeded.file.path }).click();

    const pdfCanvas = page.locator('canvas').first();
    await expect(pdfCanvas).toBeVisible();

    await page.locator('.page-input').fill('2');
    await page.locator('.page-input').press('Enter');
    await expect(page.locator('.page-info')).toContainText('/ 2');

    await expect(pdfCanvas).toHaveScreenshot('pdf-page2.png', { maxDiffPixelRatio: 0.02 });
  });

  test('拡大表示にすると、注釈レイヤーのキャンバスがPDF描画の上に正しく重なる', async ({
    page,
  }) => {
    const seeded = await seedCacheContainerWithFixturePdf(page, { containerName: 'pdf-zoom' });

    await page.locator('.exp-container-row .container-name', { hasText: 'pdf-zoom' }).click();
    await page.locator('.exp-file .file-name', { hasText: seeded.file.path }).click();

    await page.locator('.zoom-input input').fill('200');
    await page.locator('.zoom-input input').press('Enter');

    const pdfCanvas = page.locator('canvas').first();
    const annotationCanvas = stageCanvas(page);
    await expect(pdfCanvas).toBeVisible();
    await expect(annotationCanvas).toBeVisible();

    const pdfBox = await pdfCanvas.boundingBox();
    const annotationBox = await annotationCanvas.boundingBox();
    expect(pdfBox).not.toBeNull();
    expect(annotationBox).not.toBeNull();
    if (!pdfBox || !annotationBox) return;

    // 高ズーム時（タイル化が発生しうる状況）でも、注釈レイヤーはPDF描画のcanvasと
    // 同じ位置・サイズで重なっていること（z順・座標のずれはtiling.ts変更時の典型的な回帰）
    expect(annotationBox.x).toBeCloseTo(pdfBox.x, 0);
    expect(annotationBox.y).toBeCloseTo(pdfBox.y, 0);
    expect(annotationBox.width).toBeCloseTo(pdfBox.width, 0);
    expect(annotationBox.height).toBeCloseTo(pdfBox.height, 0);
  });
});
