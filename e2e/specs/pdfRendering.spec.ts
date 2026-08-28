import { expect, test } from '@playwright/test';
import { seedCacheContainerWithFixturePdf } from '../support/seed';
import { stageCanvas, waitForCanvasReady } from '../support/canvasCoords';
import { hasVisibleContent } from '../support/pixelAssertions';

test.describe('PDF文書のレンダリング', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  /**
   * フィクスチャPDFを開くと、pdf.jsが実際にページ内容（矩形＋テキスト）を
   * canvasへ描画した結果が表示されることを検証する
   */
  test('フィクスチャPDFを開くと、pdf.jsによる実際の描画結果が表示される', async ({ page }) => {
    const seeded = await seedCacheContainerWithFixturePdf(page, { containerName: 'pdf-render' });

    await page.locator('.exp-container-row .container-name', { hasText: 'pdf-render' }).click();
    await page.locator('.exp-file .file-name', { hasText: seeded.file.path }).click();

    // `.pdf-canvas`はPdfPage.vueのbackdrop用canvas（タイル分割時のタイルcanvasには
    // `.tile-canvas`が追加で付く）。`canvas`要素のDOM順に依存する`.first()`は、注釈レイヤーの
    // 追加やタイル分割の実装変更で容易に別のcanvasを指してしまうため、クラス名で明示的に絞り込む
    const pdfCanvas = page.locator('.pdf-canvas:not(.tile-canvas)').first();
    await waitForCanvasReady(pdfCanvas);

    // 実際にpdf.jsがページ内容（フィクスチャPDFの矩形＋テキスト）を描画した結果を検証する。
    // pdfManager.ts自体の座標変換ロジック（回転考慮等）はpdf.test.tsで別途検証済みのため、
    // ここでは「実ブラウザで実際に見た目どおり描画されるか」のみを見る。固定のベースライン画像は
    // 用意していない（初回生成には人によるレビューが必要で、今回のスコープ外のフォローアップ課題）
    // ため、単色（空白）ではない実際の描画内容が存在するかで判定する。
    // `waitForCanvasReady`はcanvas要素自体のDOM上の可視性しか見ておらず、pdf.jsの実際の
    // ラスタライズ（backdropへのpixel書き込み）はその後も非同期に続くため、要素が見えた直後の
    // 1回だけのスクリーンショットでは描画完了前の空白を捉えてしまうことがある。実際に内容が
    // 描かれるまでポーリングする
    await expect
      .poll(async () => hasVisibleContent(await pdfCanvas.screenshot()), { timeout: 10_000 })
      .toBe(true);
  });

  /**
   * ページ送り操作で2ページ目へ移動すると、1ページ目とは異なるそのページ固有の内容が
   * 実際に描画されることを検証する
   */
  test('2ページ目へ移動すると、そのページの内容が描画される', async ({ page }) => {
    const seeded = await seedCacheContainerWithFixturePdf(page, {
      containerName: 'pdf-page-nav',
    });

    await page.locator('.exp-container-row .container-name', { hasText: 'pdf-page-nav' }).click();
    await page.locator('.exp-file .file-name', { hasText: seeded.file.path }).click();

    // セレクタの選定理由は1つ目のテストのコメントを参照
    const pdfCanvas = page.locator('.pdf-canvas:not(.tile-canvas)').first();
    await waitForCanvasReady(pdfCanvas);

    // 1つ目のテストと同じ理由で、1ページ目の描画が実際に完了する（単色ではなくなる）まで
    // ポーリングしてから基準のスクリーンショットにする
    let page1Screenshot = await pdfCanvas.screenshot();
    await expect
      .poll(
        async () => {
          page1Screenshot = await pdfCanvas.screenshot();
          return hasVisibleContent(page1Screenshot);
        },
        { timeout: 10_000 },
      )
      .toBe(true);

    await page.locator('.page-input').fill('2');
    await page.locator('.page-input').press('Enter');
    await expect(page.locator('.page-info')).toContainText('/ 2');

    // 固定のベースライン画像は用意していない（1つ目のテストのコメントを参照）ため、
    // 1ページ目とは異なる内容（フィクスチャPDFの2ページ目は矩形・テキストの位置が異なる）が
    // 実際に描画されたかを、ページ送り前後のスクリーンショット差分で確認する。
    // `.page-info`のテキスト更新はページ送りの確定を示すだけで、2ページ目の再描画自体は
    // その後も非同期に続くため、テキスト更新直後の1回だけのスクリーンショットでは
    // 1ページ目の内容が残ったまま・または描画途中の空白を捉えてしまうことがある。
    // 「単色ではない（＝描画済み）」かつ「1ページ目と異なる」の両方を満たすまでポーリングする
    await expect
      .poll(
        async () => {
          const page2Screenshot = await pdfCanvas.screenshot();
          const visible = await hasVisibleContent(page2Screenshot);
          return visible && Buffer.compare(page1Screenshot, page2Screenshot) !== 0;
        },
        { timeout: 10_000 },
      )
      .toBe(true);
  });

  /**
   * 高ズーム（タイル分割が発生しうる状況）でも、注釈レイヤーのcanvasがPDF描画のcanvasと
   * 同じ位置・サイズで重なり続けることを検証する（z順・座標のずれはtiling.ts変更時の典型的な回帰）
   */
  test('拡大表示にすると、注釈レイヤーのキャンバスがPDF描画の上に正しく重なる', async ({
    page,
  }) => {
    const seeded = await seedCacheContainerWithFixturePdf(page, { containerName: 'pdf-zoom' });

    await page.locator('.exp-container-row .container-name', { hasText: 'pdf-zoom' }).click();
    await page.locator('.exp-file .file-name', { hasText: seeded.file.path }).click();

    // セレクタの選定理由は1つ目のテストのコメントを参照
    const pdfCanvas = page.locator('.pdf-canvas:not(.tile-canvas)').first();
    const annotationCanvas = stageCanvas(page);
    await waitForCanvasReady(pdfCanvas);
    await waitForCanvasReady(annotationCanvas);

    // ズーム操作前の基準サイズを記録しておく（後続のポーリングで「実際にズームが
    // 反映されたか」を判定する基準にする）
    const beforeBox = await pdfCanvas.boundingBox();
    expect(beforeBox).not.toBeNull();
    if (!beforeBox) return;

    await page.locator('.zoom-input input').fill('200');
    await page.locator('.zoom-input input').press('Enter');

    // ズーム入力の確定（Enter）自体は即座に完了するが、実際の再描画（canvas要素の
    // 新しいズーム倍率でのリサイズ・pdf.jsによる再ラスタライズ・高ズーム時のタイル分割）は
    // 非同期に続く。入力確定直後にboundingBoxを読むと、まだ旧ズーム時点のサイズのままの
    // canvasを捉えてしまい、以降のアサーションが偶然一致する／しないの水物になりうるため、
    // 実際に表示サイズが変化する（200%指定でおよそ倍になる）までポーリングしてから進める
    await expect
      .poll(
        async () => {
          const box = await pdfCanvas.boundingBox();
          return box?.width ?? 0;
        },
        { timeout: 10_000 },
      )
      .toBeGreaterThan(beforeBox.width * 1.5);

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
