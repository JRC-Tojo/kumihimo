import { test as base, expect, type Page, type Locator } from '@playwright/test';

/**
 * デモコンテナ（`cache`型・IndexedDBのみで完結する）を作成し、最初のPDF文書を開いた状態を
 * 提供するPlaywrightフィクスチャ
 *
 * 実際のローカルフォルダ・Boxストレージへは一切アクセスせず、アプリに既存の
 * 「デモデータ作成」機能（`src/utils/appInitializer.ts`のcreateDemoData）をそのまま
 * モックデータ生成として利用する。各テストはブラウザコンテキストが独立しており、
 * IndexedDBも都度まっさらな状態から始まる
 */

/** appInitializer.tsのsampleDocsで最初に生成されるファイル名 */
export const DEMO_FIRST_FILE_NAME = 'システム要件定義書.pdf';

/** Konvaステージのcanvas要素（アノテーションレイヤー）を返す */
export function stageCanvas(page: Page): Locator {
  return page.locator('.annotation-layer-wrapper canvas').first();
}

/** メインツールバー・サブツールバーのボタンをtool.idで特定する */
export function toolButton(page: Page, toolId: string): Locator {
  return page.getByTestId(`tool-${toolId}`);
}

export function subToolButton(page: Page, toolId: string): Locator {
  return page.getByTestId(`subtool-${toolId}`);
}

/**
 * デモコンテナを作成し、最初のPDF文書をエディタで開く
 *
 * 前提: ブラウザコンテキストのIndexedDBが空（＝コンテナが1つも読み込まれていない）状態。
 * その場合のみExplorerViewに「Create Demo Data」ボタンが表示される
 */
export async function openDemoDocument(page: Page): Promise<void> {
  await page.goto('/');

  // 開発サーバー（Vite）はコールドスタート時、初めて触れるコード経路ごとに依存関係の
  // 事前バンドルをやり直し、その都度ページを自動リロードすることがある（複数回起こりうる）。
  // これが収まりきる前に操作すると、途中の非同期処理（デモデータ作成等）が中断されてしまう
  // ため、ネットワークが落ち着くまで待つ（devServerのHMR用WebSocketは待機の妨げにならない）
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined);

  // AppSettings.localeの既定値は'ja-JP'（src/models/settings.ts）のため、
  // フレッシュなIndexedDBでは常に日本語UIで起動する
  await page.getByRole('button', { name: 'デモデータを作成' }).click();

  // コンテナ行（折りたたみ状態）をクリックして展開する
  // デモデータ作成は6文書分のフェッチ・パック・保存を伴うため、通常より長めに待つ
  const containerRow = page.locator('.exp-container-row', { hasText: 'DEMO CONTAINER' });
  await expect(containerRow).toBeVisible({ timeout: 30000 });
  await containerRow.click();

  const fileEntry = page.locator('.exp-file', { hasText: DEMO_FIRST_FILE_NAME });
  await expect(fileEntry).toBeVisible();
  await fileEntry.click();

  await expect(stageCanvas(page)).toBeVisible();

  // 右ドレワーはデフォルトで閉じているため、以降の検証のために開いておく
  await toolButton(page, 'toggle-right-drawer').click();
}

/**
 * ステージのCanvas上で、境界ボックスに対する割合位置(xFrac/yFrac)から始まる矩形をドラッグ操作で描く
 *
 * デモデータ側のランダム生成アノテーション（ドキュメント座標でx<500, y<600の範囲にのみ存在）と
 * 衝突しないよう、テストからは常にステージ右下寄りの領域（xFrac/yFracとも0.8以上）を使う
 */
export async function dragDrawAt(
  page: Page,
  canvas: Locator,
  xFrac: number,
  yFrac: number,
  widthPx = 60,
  heightPx = 40,
): Promise<{ centerX: number; centerY: number }> {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('ステージのcanvasが見つかりません');

  const startX = box.x + box.width * xFrac;
  const startY = box.y + box.height * yFrac;
  const endX = Math.min(startX + widthPx, box.x + box.width - 1);
  const endY = Math.min(startY + heightPx, box.y + box.height - 1);

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move((startX + endX) / 2, (startY + endY) / 2);
  await page.mouse.move(endX, endY);
  await page.mouse.up();

  return { centerX: (startX + endX) / 2, centerY: (startY + endY) / 2 };
}

export const test = base;
export { expect };
