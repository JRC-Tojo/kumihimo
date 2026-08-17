import type { Page } from '@playwright/test';
import { buildFixturePdfBase64 } from '../fixtures/buildFixturePdf';
import { waitForTestHook, type TestAnnotationStyle, type TestContainerFile } from './testHook';

export interface SeededDocument {
  containerId: string;
  file: TestContainerFile;
}

/**
 * `page.reload()`を実行する。失敗時は少し待って最大2回まで再試行する。
 *
 * `src/repositories/inMemory/IndexedDB.ts`は新規ストア作成時にバージョンを1つずつ
 * 上げて再オープンする実装で、その`onblocked`ハンドラは自発的に`window.location.reload()`を
 * 呼ぶ。この自発リロードと本関数のreload()呼び出しがまれに競合し、`net::ERR_ABORTED`に
 * なることがあるため、単純な再試行で吸収する
 */
async function reloadResilient(page: Page): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.reload();
      return;
    } catch (e) {
      if (attempt >= 2) throw e;
      await page.waitForTimeout(300);
    }
  }
}

/**
 * インメモリの`cache`コンテナへフィクスチャPDFを1件投入する。
 *
 * `ExplorerView.vue`はコンテナ一覧を`onMounted`時にのみ取得するため、BackendApi経由で
 * 直接作成したコンテナはページをリロードするまでExplorer上に現れない
 * （`createContainer`は`cache`型でも実体はIndexedDBへ保存されるため、リロードでも消えない）。
 *
 * `createContainer`→`loadContainer`→`saveFile`は、初回はそれぞれ別のIndexedDBストアを
 * 新規作成する（`cache.ts`のSKEL/ELEM/SOURCE_STORE_NAME）。ストア作成のたびにDBのバージョンを
 * 上げて再オープンするため、間を置かずに連続実行すると直前の接続のクローズが完了する前に
 * 次のオープンが走り、上記の`onblocked`（自発リロード）を誘発しやすい。各呼び出しの間に
 * 短い待機を挟むことで、実運用ではほぼ発生しないこの競合をテストのたびに再現しないようにする
 */
export async function seedCacheContainerWithFixturePdf(
  page: Page,
  options: { containerName?: string; fileName?: string } = {},
): Promise<SeededDocument> {
  await waitForTestHook(page);
  const fixtureSrc = await buildFixturePdfBase64();
  const containerName = options.containerName ?? `e2e-${Math.random().toString(36).slice(2)}`;
  const fileName = options.fileName ?? 'sample.pdf';

  const result = await page.evaluate(
    async ({ containerName, fileName, fixtureSrc }) => {
      const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
      const api = window.__kumihimoTest?.api;
      if (!api) throw new Error('__kumihimoTest hook is not available');

      const containerRes = await api.createContainer('cache', containerName, '/');
      if (!containerRes.ok || !containerRes.data) throw new Error('createContainer failed');
      const containerId = containerRes.data.id;
      await settle();

      const loadRes = await api.loadContainer(containerId);
      if (!loadRes.ok) throw new Error('loadContainer failed');
      await settle();

      const fileRes = await api.saveFile(containerId, fileName, fixtureSrc);
      if (!fileRes.ok || !fileRes.data) throw new Error('saveFile failed');

      return { containerId, file: fileRes.data };
    },
    { containerName, fileName, fixtureSrc },
  );

  await reloadResilient(page);
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
