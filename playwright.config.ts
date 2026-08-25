import { defineConfig, devices } from '@playwright/test';

/**
 * 関係性・アノテーション操作・PDFレンダリングの「ビジュアル/操作感」E2Eテスト用設定。
 *
 * ロジック層は`bun test --isolate`で検証済みのため、ここでは実Chromiumでの実描画・
 * 実操作のみを対象とする（`bun run test:e2e`。既存の`bun run test`とは完全に分離）。
 *
 * 注意: Windows環境ではBunランタイムでChromiumを起動すると既知の不具合でハングするため
 * （`chromium.launch()`がタイムアウトする。oven-sh/bun#27977等）、`npx playwright test`
 * （Node.js）で実行すること。Linux/macOSでは再現しない
 */
export default defineConfig({
  testDir: './e2e/specs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // 対象は`bun run dev`（Vite開発サーバー）1プロセスのみで、水平スケールしない。並列ワーカーが
  // 複数同時にcold状態のモジュールコンパイル（pdfjs-dist/Konva等、重量級）を要求すると、
  // 一部のワーカーの初回描画がタイムアウトしうるため、常に直列実行する（CI/ローカール問わず）
  workers: 1,
  // 'list'はコンソール出力のみでplaywright-report/を生成しないため、CI失敗時にアップロードする
  // レポート（.github/workflows/frontend.ymlのUpload Playwright reportステップ）用にhtmlも併用する
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://localhost:9200',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:9200',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
