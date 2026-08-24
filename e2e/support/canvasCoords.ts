import { expect, type Locator, type Page } from '@playwright/test';

export interface DocPoint {
  x: number;
  y: number;
}

export interface DocSize {
  width: number;
  height: number;
}

/**
 * `AnnotationLayer.vue`がマウントするKonva `v-stage`のcanvas要素を返す
 * （`.annotation-layer-wrapper > .konvajs-content > canvas`。複数ページ表示時は
 * 最初に見えているものを対象とする）
 */
export function stageCanvas(page: Page): Locator {
  return page.locator('.annotation-layer-wrapper canvas').first();
}

/**
 * 描画系canvas（PDF描画・注釈レイヤーいずれも）が実際に表示されるまで待つ。
 *
 * `PdfPage.vue`は`canvasRendered`（pdf.jsによる初回`render()`完了後）まで
 * `.annotation-layer-wrapper`自体をマウントしない（`v-if="canvasRendered"`）ため、
 * これらのcanvasはDOM上に存在しない状態からスタートする。Playwrightの`expect`の既定タイムアウトは
 * 5秒だが、CI環境（特にVite開発サーバーのコールドコンパイル直後、pdf.js/Konvaを初めて
 * 読み込むタイミング）では初回描画がそれを超えることがあり、`toBeVisible()`が
 * タイムアウトして「canvasの情報が取得できない」失敗につながっていた。この専用ヘルパーで
 * 個別に長めのタイムアウトを与えることで、他の（描画を伴わない）通常のUI操作アサーションの
 * タイムアウトは短いまま保つ
 */
export async function waitForCanvasReady(canvas: Locator, timeoutMs = 20_000): Promise<void> {
  await expect(canvas).toBeVisible({ timeout: timeoutMs });
}

/**
 * ドキュメント座標系（PDFページ自体のポイント座標）の点を、実際のブラウザ表示上の座標
 * （Playwrightの`page.mouse`系APIへ渡せる座標）へ変換する。
 *
 * `AnnotationLayer.vue`が受け取る`scale`はズーム倍率そのものではなく、PdfPage側で
 * 解像度上限にクランプされた内部描画スケールのため、アプリ内部の値をそのまま使うのではなく、
 * canvasの実際の表示サイズ（`boundingBox`）と既知のページサイズ（フィクスチャPDFで
 * 固定済み）から実効スケールを逆算する。これにより内部実装の詳細に依存せず安定する
 */
export async function docPointToPagePosition(
  canvas: Locator,
  point: DocPoint,
  pageSize: DocSize,
): Promise<DocPoint> {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas is not visible');
  const scaleX = box.width / pageSize.width;
  const scaleY = box.height / pageSize.height;
  return {
    x: box.x + point.x * scaleX,
    y: box.y + point.y * scaleY,
  };
}
