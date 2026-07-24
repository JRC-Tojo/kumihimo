import { describe, expect, it, mock } from 'bun:test';
import { Failure, Success } from 'src/models/error/result';
import type { Result } from 'src/models/error/result';
import type { CatalogEntry, InstalledPlugin } from 'src/models/plugin/installation';
import { PluginID, type PluginManifest } from 'src/models/plugin/manifest';
import type { PluginSubmissionDraft } from 'src/models/plugin/submission';

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

/**
 * catalogリポジトリの既定実装は「このテストでは未使用」を表すFailureで固定しておき、
 * `installFromCatalog`を検証する各テストが`mockImplementationOnce`で個別に差し替える
 * （他のテストへ影響しないよう、差し替えない限りは常に安全なFailureへフォールバックする）
 */
const getCatalogEntriesMock = mock((): Promise<Result<CatalogEntry[]>> =>
  Promise.resolve(Failure(new Error('not used in this test'))),
);
const getCatalogBinaryMock = mock((): Promise<Result<Uint8Array>> =>
  Promise.resolve(Failure(new Error('not used in this test'))),
);
const getCatalogIconMock = mock((): Promise<Result<Uint8Array>> =>
  Promise.resolve(Failure(new Error('not used in this test'))),
);

void mock.module('src/repositories/plugin/catalog', () => ({
  getCatalogEntries: getCatalogEntriesMock,
  getCatalogBinary: getCatalogBinaryMock,
  getCatalogIcon: getCatalogIconMock,
}));

const {
  installPlugin,
  installFromDraft,
  installFromCatalog,
  setPluginEnabled,
  getInstalledPlugins,
  uninstallPlugin,
  getPluginBinary,
} = await import('../install');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

function buildDraft(overrides: Partial<PluginSubmissionDraft> = {}): PluginSubmissionDraft {
  return {
    name: 'サイドロードプラグイン',
    version: '1.0.0',
    description: '',
    runtime: 'wasm',
    mainFile: 'sideload.wasm',
    requiredHostApis: [],
    ...overrides,
  };
}

/** カタログエントリ（`getCatalogEntries`の戻り値要素）を組み立てる */
function buildCatalogEntry(
  manifest: PluginManifest,
  overrides: Partial<CatalogEntry> = {},
): CatalogEntry {
  return { manifest, publishedAt: new Date(), ...overrides };
}

// PNGのマジックナンバー（`sniffImageFormat`が判定に使うシグネチャそのもの）
const PNG_SIGNATURE_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);

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

describe('installFromDraft（サイドロード: id/ownerを持たないフォーム入力から採番・上書きする）', () => {
  it('同名の既存サイドロード済みプラグインが無ければ、新規にUUIDを採番する', async () => {
    const draft = buildDraft({ name: '新規サイドロードA', mainFile: 'a.wasm' });

    const res = await installFromDraft(draft, new Uint8Array([1]), undefined);
    expect(res.ok).toBeTrue();

    const listRes = await getInstalledPlugins();
    expect(listRes.ok).toBeTrue();
    if (!listRes.ok) return;
    const found = listRes.value.find(
      (e) => e.manifest.name === draft.name && e.source === 'sideload',
    );
    expect(found).toBeDefined();
    expect(String(found?.manifest.id)).toMatch(UUID_PATTERN);
  });

  it('同名の既存サイドロード済みプラグインがあれば、そのidを再利用して上書きする（レコードが増えない）', async () => {
    const draft = buildDraft({ name: '再インストール対象', mainFile: 'b.wasm' });

    await installFromDraft(draft, new Uint8Array([1]), undefined);
    const firstListRes = await getInstalledPlugins();
    expect(firstListRes.ok).toBeTrue();
    if (!firstListRes.ok) return;
    const firstEntry = firstListRes.value.find(
      (e) => e.manifest.name === draft.name && e.source === 'sideload',
    );
    expect(firstEntry).toBeDefined();
    const firstId = firstEntry?.manifest.id;

    // 開発中のビルドを更新して再インストールしたケースを模す
    await installFromDraft({ ...draft, version: '1.0.1' }, new Uint8Array([2]), undefined);

    const secondListRes = await getInstalledPlugins();
    expect(secondListRes.ok).toBeTrue();
    if (!secondListRes.ok) return;
    const matching = secondListRes.value.filter(
      (e) => e.manifest.name === draft.name && e.source === 'sideload',
    );
    expect(matching).toHaveLength(1);
    expect(matching[0]?.manifest.id).toBe(firstId);
    expect(matching[0]?.manifest.version).toBe('1.0.1');
  });

  it('カタログ版が同名で存在するだけでは既存として扱わない（sideload限定でマッチする）', async () => {
    const catalogManifest = { ...buildManifest('catalog-only-id'), name: '共存プラグイン' };
    await installPlugin(catalogManifest, new Uint8Array([9]), undefined, 'catalog');

    const draft = buildDraft({ name: '共存プラグイン', mainFile: 'c.wasm' });
    const res = await installFromDraft(draft, new Uint8Array([1]), undefined);
    expect(res.ok).toBeTrue();

    const listRes = await getInstalledPlugins();
    expect(listRes.ok).toBeTrue();
    if (!listRes.ok) return;
    const sideloadEntry = listRes.value.find(
      (e) => e.manifest.name === '共存プラグイン' && e.source === 'sideload',
    );
    const catalogEntry = listRes.value.find(
      (e) => e.manifest.name === '共存プラグイン' && e.source === 'catalog',
    );
    expect(sideloadEntry).toBeDefined();
    expect(catalogEntry).toBeDefined();
    expect(sideloadEntry?.manifest.id).not.toBe(catalogEntry?.manifest.id);
  });
});

describe('installPlugin（アイコンのdata URL化: toIconDataUrl経由）', () => {
  it('PNGシグネチャを持つ有効なアイコンバイト列を渡すと、iconDataUrlがdata:image/png;base64,...になる', async () => {
    const manifest = buildManifest('icon-png-id');

    await installPlugin(manifest, new Uint8Array([1]), PNG_SIGNATURE_BYTES, 'sideload');

    const listRes = await getInstalledPlugins();
    expect(listRes.ok).toBeTrue();
    if (!listRes.ok) return;
    const found = listRes.value.find(
      (e) => e.manifest.id === manifest.id && e.source === 'sideload',
    );
    expect(found?.iconDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('非対応形式（シグネチャに一致しない）のバイト列を渡すと、iconDataUrlはundefinedのままになる', async () => {
    const manifest = buildManifest('icon-unsupported-id');

    await installPlugin(manifest, new Uint8Array([1]), new Uint8Array([1, 2, 3]), 'sideload');

    const listRes = await getInstalledPlugins();
    expect(listRes.ok).toBeTrue();
    if (!listRes.ok) return;
    const found = listRes.value.find(
      (e) => e.manifest.id === manifest.id && e.source === 'sideload',
    );
    expect(found?.iconDataUrl).toBeUndefined();
  });
});

describe('installFromCatalog（カタログからのインストール）', () => {
  it('getCatalogEntriesが失敗したら、そのまま失敗が伝播する', async () => {
    getCatalogEntriesMock.mockImplementationOnce(() =>
      Promise.resolve(Failure(new Error('network error'))),
    );

    const res = await installFromCatalog(PluginID.parse('11111111-1111-4111-8111-111111111111'));

    expect(res.ok).toBeFalse();
    if (!res.ok) expect(res.error.message).toBe('network error');
  });

  it('指定したidに一致するカタログエントリが無い場合は、Not Found Catalog EntryのFailureを返す', async () => {
    const otherManifest = buildManifest('other-catalog-id');
    getCatalogEntriesMock.mockImplementationOnce(() =>
      Promise.resolve(Success([buildCatalogEntry(otherManifest)])),
    );

    const missingId = PluginID.parse('22222222-2222-4222-8222-222222222222');
    const res = await installFromCatalog(missingId);

    expect(res.ok).toBeFalse();
    if (!res.ok) expect(res.error.message).toContain('Not Found Catalog Entry');
  });

  it('正常系: バイナリ・アイコン取得に成功したら、source: catalogでインストールされ一覧に反映される', async () => {
    const manifest = { ...buildManifest('catalog-success-id'), iconFile: 'icon.png' };
    getCatalogEntriesMock.mockImplementationOnce(() =>
      Promise.resolve(Success([buildCatalogEntry(manifest)])),
    );
    getCatalogBinaryMock.mockImplementationOnce(() =>
      Promise.resolve(Success(new Uint8Array([1, 2, 3]))),
    );
    getCatalogIconMock.mockImplementationOnce(() => Promise.resolve(Success(PNG_SIGNATURE_BYTES)));

    const res = await installFromCatalog(manifest.id);
    expect(res.ok).toBeTrue();

    const listRes = await getInstalledPlugins();
    expect(listRes.ok).toBeTrue();
    if (!listRes.ok) return;
    const found = listRes.value.find(
      (e) => e.manifest.id === manifest.id && e.source === 'catalog',
    );
    expect(found).toBeDefined();
    expect(found?.iconDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('iconFileが未指定の場合は、getCatalogIconを呼ばずにインストールされる', async () => {
    const manifest = buildManifest('catalog-no-icon-id');
    getCatalogEntriesMock.mockImplementationOnce(() =>
      Promise.resolve(Success([buildCatalogEntry(manifest)])),
    );
    getCatalogBinaryMock.mockImplementationOnce(() =>
      Promise.resolve(Success(new Uint8Array([1, 2, 3]))),
    );
    getCatalogIconMock.mockClear();

    const res = await installFromCatalog(manifest.id);

    expect(res.ok).toBeTrue();
    expect(getCatalogIconMock).not.toHaveBeenCalled();
  });

  it('getCatalogIconが失敗しても、アイコン無しでインストール自体は続行される', async () => {
    const manifest = { ...buildManifest('catalog-icon-fail-id'), iconFile: 'icon.png' };
    getCatalogEntriesMock.mockImplementationOnce(() =>
      Promise.resolve(Success([buildCatalogEntry(manifest)])),
    );
    getCatalogBinaryMock.mockImplementationOnce(() =>
      Promise.resolve(Success(new Uint8Array([1, 2, 3]))),
    );
    getCatalogIconMock.mockImplementationOnce(() =>
      Promise.resolve(Failure(new Error('icon fetch failed'))),
    );

    const res = await installFromCatalog(manifest.id);
    expect(res.ok).toBeTrue();

    const listRes = await getInstalledPlugins();
    expect(listRes.ok).toBeTrue();
    if (!listRes.ok) return;
    const found = listRes.value.find(
      (e) => e.manifest.id === manifest.id && e.source === 'catalog',
    );
    expect(found).toBeDefined();
    expect(found?.iconDataUrl).toBeUndefined();
  });
});

describe('setPluginEnabled', () => {
  it('pluginDb.getInstalledPluginが失敗したら、そのまま失敗が伝播する', async () => {
    const res = await setPluginEnabled(
      PluginID.parse('33333333-3333-4333-8333-333333333333'),
      'sideload',
      false,
    );
    expect(res.ok).toBeFalse();
  });

  it('成功時はenabledだけ変更してputInstalledPluginする', async () => {
    const manifest = buildManifest('enabled-toggle-id');
    await installPlugin(manifest, new Uint8Array([1]), undefined, 'sideload');

    const res = await setPluginEnabled(manifest.id, 'sideload', false);
    expect(res.ok).toBeTrue();

    const listRes = await getInstalledPlugins();
    expect(listRes.ok).toBeTrue();
    if (!listRes.ok) return;
    const found = listRes.value.find(
      (e) => e.manifest.id === manifest.id && e.source === 'sideload',
    );
    expect(found?.enabled).toBeFalse();
    // manifest等の他フィールドは変更されていないこと
    expect(found?.manifest.name).toBe(manifest.name);
  });
});
