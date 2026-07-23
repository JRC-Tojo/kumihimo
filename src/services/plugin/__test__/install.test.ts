import { describe, expect, it, mock } from 'bun:test';
import { Failure, Success } from 'src/models/error/result';
import type { InstalledPlugin } from 'src/models/plugin/installation';
import type { PluginManifest } from 'src/models/plugin/manifest';

/**
 * `src/repositories/db/plugin.ts`・`src/repositories/plugin/binaryStore.ts`が実際に使う
 * 「`${source}::${id}`」複合キー方式を、Mapベースの簡易フェイクで再現する
 * （このリポジトリのbunテスト環境には実IndexedDB/Dexieが無いため、実ストレージ層は
 * モック化し、キーの組み立てが正しく「catalog/sideloadを別レコードとして扱う」ことのみを検証する）
 */
const installedStore = new Map<string, InstalledPlugin>();
const binaryStoreMap = new Map<string, Uint8Array>();

function key(id: string, source: string): string {
  return `${source}::${id}`;
}

// 注意: `bun test`のmock.moduleはプロセス全体で共有されるため、他ファイル
// （run.test.ts等）が必要とする関数も安全なスタブとして含めておくこと
void mock.module('src/repositories/db/plugin', () => ({
  getInstalledPlugins: () => Promise.resolve(Success(Array.from(installedStore.values()))),
  getInstalledPlugin: (id: string, source: string) => {
    const found = installedStore.get(key(id, source));
    return Promise.resolve(found ? Success(found) : Failure(new Error('not found')));
  },
  putInstalledPlugin: (entry: InstalledPlugin) => {
    installedStore.set(key(entry.manifest.id, entry.source), entry);
    return Promise.resolve(Success(undefined));
  },
  deleteInstalledPlugin: (id: string, source: string) => {
    installedStore.delete(key(id, source));
    return Promise.resolve(Success(undefined));
  },
  getRunState: () => Promise.resolve(Failure(new Error('not used in this test'))),
  putRunState: () => Promise.resolve(Failure(new Error('not used in this test'))),
  observeRunState: () => {
    throw new Error('not used in this test');
  },
  getDismissedSubmissionPrNumbers: () =>
    Promise.resolve(Failure(new Error('not used in this test'))),
  dismissSubmission: () => Promise.resolve(Failure(new Error('not used in this test'))),
}));

void mock.module('src/repositories/plugin/binaryStore', () => ({
  setBinary: (pluginId: string, source: string, bytes: Uint8Array) => {
    binaryStoreMap.set(key(pluginId, source), bytes);
    return Promise.resolve(Success(undefined));
  },
  getBinary: (pluginId: string, source: string) => {
    const found = binaryStoreMap.get(key(pluginId, source));
    return Promise.resolve(found ? Success(found) : Failure(new Error('not found')));
  },
  deleteBinary: (pluginId: string, source: string) => {
    binaryStoreMap.delete(key(pluginId, source));
    return Promise.resolve(Success(undefined));
  },
}));

void mock.module('src/repositories/plugin/catalog', () => ({
  getCatalogEntries: () => Promise.resolve(Failure(new Error('not used in this test'))),
  getCatalogBinary: () => Promise.resolve(Failure(new Error('not used in this test'))),
  getCatalogIcon: () => Promise.resolve(Failure(new Error('not used in this test'))),
}));

const { installPlugin, getInstalledPlugins, uninstallPlugin, getPluginBinary } =
  await import('../install');

function buildManifest(id: string): PluginManifest {
  return {
    id: id as never,
    name: 'テストプラグイン',
    version: '1.0.0',
    description: '',
    runtime: 'wasm',
    mainFile: 'test.wasm',
    requiredHostApis: [],
  };
}

describe('install（catalog/sideloadの共存）', () => {
  it('同一manifest.idをcatalog/sideloadそれぞれでインストールすると、両方が個別に一覧へ現れる', async () => {
    const manifest = buildManifest('shared-plugin-id');

    await installPlugin(manifest, new Uint8Array([1]), undefined, 'catalog');
    await installPlugin(manifest, new Uint8Array([2]), undefined, 'sideload');

    const res = await getInstalledPlugins();
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const matching = res.value.filter((e) => e.manifest.id === manifest.id);
    expect(matching).toHaveLength(2);
    expect(matching.map((e) => e.source).sort()).toEqual(['catalog', 'sideload']);
  });

  it('本体バイナリもcatalog/sideloadで別々に保持され、片方をuninstallしてももう片方は残る', async () => {
    const manifest = buildManifest('another-shared-id');

    await installPlugin(manifest, new Uint8Array([10]), undefined, 'catalog');
    await installPlugin(manifest, new Uint8Array([20]), undefined, 'sideload');

    await uninstallPlugin(manifest.id, 'sideload');

    const catalogBinRes = await getPluginBinary(manifest.id, 'catalog');
    expect(catalogBinRes.ok).toBeTrue();
    if (catalogBinRes.ok) expect(Array.from(catalogBinRes.value)).toEqual([10]);

    const sideloadBinRes = await getPluginBinary(manifest.id, 'sideload');
    expect(sideloadBinRes.ok).toBeFalse();

    const listRes = await getInstalledPlugins();
    expect(listRes.ok).toBeTrue();
    if (!listRes.ok) return;
    const remaining = listRes.value.filter((e) => e.manifest.id === manifest.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.source).toBe('catalog');
  });
});
