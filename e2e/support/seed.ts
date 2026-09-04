import type { Page } from '@playwright/test';
import { buildFixturePdfBase64 } from '../fixtures/buildFixturePdf';
import { waitForTestHook, type TestAnnotationStyle, type TestContainerFile } from './testHook';

export interface SeededDocument {
  containerId: string;
  file: TestContainerFile;
}

/**
 * インメモリの`cache`コンテナへフィクスチャPDFを1件投入する。
 *
 * `ExplorerView.vue`はコンテナ一覧を`onMounted`時にのみ取得するため、BackendApi経由で
 * 直接作成したコンテナはページをリロードするまでExplorer上に現れない
 * （`createContainer`は`cache`型でも実体はIndexedDBへ保存されるため、リロードでも消えない）
 */
export async function seedCacheContainerWithFixturePdf(
  page: Page,
  options: { containerName?: string; fileName?: string } = {},
): Promise<SeededDocument> {
  await waitForTestHook(page);
  const fixtureSrc = await buildFixturePdfBase64();
  const containerName = options.containerName ?? `e2e-${Math.random().toString(36).slice(2)}`;
  const fileName = options.fileName ?? 'sample.pdf';

  // ブラウザ内（`window.__kumihimoTest.api`経由）で`createContainer`→`loadContainer`→
  // `saveFile`を順に実行し、フィクスチャPDFを1件持つ`cache`コンテナを用意する。
  // Node側（Playwright）からではなくpage.evaluate内で行うのは、BackendApiがブラウザの
  // IndexedDB上に構築されるインメモリ実装であり、Node側から直接操作する経路が無いため
  const result = await page.evaluate(
    async ({ containerName, fileName, fixtureSrc }) => {
      // 失敗時に`ApiResponseFailure.error`（key・元エラーのmessage）を投げるエラーに埋め込む。
      // CI上での間欠的な失敗（特にloadContainer）は、再現待ちなしに実際の失敗理由が
      // Playwrightのエラー出力からそのまま追えるようにしておく必要があるため
      const describeFailure = (res: { error?: unknown }): string => {
        const err = res.error as { key?: unknown; error?: { message?: unknown } } | undefined;
        const key = typeof err?.key === 'string' ? err.key : undefined;
        const message = typeof err?.error?.message === 'string' ? err.error.message : undefined;
        return [key, message].filter(Boolean).join(': ') || JSON.stringify(res.error);
      };

      const api = window.__kumihimoTest?.api;
      if (!api) throw new Error('__kumihimoTest hook is not available');

      const containerRes = await api.createContainer('cache', containerName, '/');
      if (!containerRes.ok || !containerRes.data) {
        throw new Error(`createContainer failed: ${describeFailure(containerRes)}`);
      }
      const containerId = containerRes.data.id;

      const loadRes = await api.loadContainer(containerId);
      if (!loadRes.ok) throw new Error(`loadContainer failed: ${describeFailure(loadRes)}`);

      const fileRes = await api.saveFile(containerId, fileName, fixtureSrc);
      if (!fileRes.ok || !fileRes.data) {
        throw new Error(`saveFile failed: ${describeFailure(fileRes)}`);
      }

      return { containerId, file: fileRes.data };
    },
    { containerName, fileName, fixtureSrc },
  );

  await page.reload();
  await waitForTestHook(page);

  return result;
}

/** 指定したアノテーションを登録する（プリセット注釈の事前投入用） */
export async function registerAnnotation(
  page: Page,
  file: TestContainerFile,
  style: TestAnnotationStyle,
): Promise<void> {
  const ok = await page.evaluate(
    async ({ file, style }) => {
      const api = window.__kumihimoTest?.api;
      if (!api) throw new Error('__kumihimoTest hook is not available');
      const res = await api.registerAnnotationStyle(file, style);
      return res.ok;
    },
    { file, style },
  );
  if (!ok) throw new Error('registerAnnotation failed');
}

/** srcID・targetIDのアノテーション間に関係性を登録する */
export async function registerRelational(
  page: Page,
  srcID: string,
  targetID: string,
  ruleType: 'equal' | 'link' = 'equal',
): Promise<void> {
  const ok = await page.evaluate(
    async ({ srcID, targetID, ruleType }) => {
      const api = window.__kumihimoTest?.api;
      if (!api) throw new Error('__kumihimoTest hook is not available');
      const res = await api.registRelationals({ srcID, targetID, rule: { type: ruleType } });
      return res.ok;
    },
    { srcID, targetID, ruleType },
  );
  if (!ok) throw new Error('registerRelational failed');
}

/** boxアノテーションのスタイルオブジェクトを組み立てる（pdf.test.tsのbuildAnnotationBaseと同じ形） */
export function buildBoxAnnotationStyle(opts: {
  id: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
}): TestAnnotationStyle {
  const now = new Date().toISOString();
  return {
    id: opts.id,
    type: 'box',
    pageNumber: opts.pageNumber,
    x: opts.x,
    y: opts.y,
    width: opts.width,
    height: opts.height,
    color: opts.color ?? '#ff0000',
    strokeWidth: 2,
    strokeType: 'solid',
    createdAt: now,
    updatedAt: now,
    comment: {},
  };
}

/**
 * 直線アノテーションのスタイルオブジェクトを組み立てる。
 * `points`は文書座標系の絶対座標（`[x1, y1, x2, y2]`）で指定する（`x`/`y`は0固定にし、
 * pointsをそのまま絶対座標として扱えるようにする）
 */
export function buildLineAnnotationStyle(opts: {
  id: string;
  pageNumber: number;
  points: [number, number, number, number];
  color?: string;
  strokeWidth?: number;
}): TestAnnotationStyle {
  const now = new Date().toISOString();
  return {
    id: opts.id,
    type: 'line',
    pageNumber: opts.pageNumber,
    x: 0,
    y: 0,
    points: opts.points,
    color: opts.color ?? '#0000ff',
    strokeWidth: opts.strokeWidth ?? 2,
    strokeType: 'solid',
    createdAt: now,
    updatedAt: now,
    comment: {},
  };
}
