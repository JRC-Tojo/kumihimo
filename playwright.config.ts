import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E テスト設定
 *
 * アノテーション描画やドキュメント操作など、実ブラウザでの操作を伴う機能を検証する。
 * webServer には `bun run dev`（Quasar dev server, pwa モード）を利用し、
 * 環境変数 PW_TEST を通じて devServer の自動ブラウザオープンを抑止する。
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? { workers: 2 } : {}),
  reporter: process.env.CI
    ? [
        ['list'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
        ['json', { outputFile: 'playwright-report/results.json' }],
        ['github'],
      ]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    // quasar.config.tsのvueRouterBaseは本番/開発を問わず常に'/RelationalDocuments/'固定
    // （NODE_ENV分岐があるのはpublicPathのみ）のため、dev serverもこのパス配下で動作する
    baseURL: 'http://localhost:9200/RelationalDocuments/',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // GPU/DRMデバイスの無いコンテナ環境（CI含む）でGPUプロセスが繰り返しクラッシュし
        // ブラウザ全体が使用不能になるのを防ぐため、GPUを無効化してソフトウェア描画で動かす
        // （ソフトウェアラスタライザ自体は無効化しない。両方無効化すると描画手段自体が無くなりクラッシュする）。
        // /dev/shmが小さいコンテナでレンダラーがクラッシュするのを避けるため、共有メモリ使用も無効化する
        launchOptions: {
          args: ['--disable-gpu', '--disable-dev-shm-usage'],
        },
      },
    },
  ],

  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:9200/RelationalDocuments/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { PW_TEST: '1' },
  },
});
