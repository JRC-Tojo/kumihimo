/**
 * catalog.ts の単体テスト
 *
 * 実際のGitHubへは通信せず、`src/repositories/plugin/githubApi`をモックに差し替えて検証する
 * （`submissionGithub.test.ts`と同じ方式）。
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Failure, Success } from 'src/models/error/result';
import type { Result } from 'src/models/error/result';
import type { PluginManifest } from 'src/models/plugin/manifest';

const STORE_REPO_OWNER = 'JRC-Tojo';
const STORE_REPO_NAME = 'RD-PluginStock';
const STORE_REPO_DEFAULT_BRANCH = 'main';

/** raw.githubusercontent.comのURLを組み立てる（githubApi.tsの実装を再現する） */
function buildRawFileUrl(owner: string, repo: string, ref: string, path: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
}

let treeResult: Result<string[]> = Success([]);
/** パスをキーにしたファイル本文（未登録のパスはNot Found扱い） */
let fileTextByPath = new Map<string, string>();
/** パスをキーにした最終コミット日時の取得結果（未登録のパスは失敗＝取得時刻へフォールバック） */
let commitDateByPath = new Map<string, Result<Date>>();

const getTreeMock = mock(() => Promise.resolve(treeResult));
const fetchRawTextMock = mock((url: string) => {
  for (const [path, text] of fileTextByPath) {
    if (url.endsWith(path)) return Promise.resolve(Success(text));
  }
  return Promise.resolve(Failure(new Error(`Not Found: ${url}`)));
});
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
const fetchRawBinaryMock = mock((...args: unknown[]) =>
  Promise.resolve(Success(new Uint8Array([1, 2, 3]))),
);
const getLastCommitDateForPathMock = mock((...args: unknown[]) => {
  const path = String(args[2]);
  return Promise.resolve(commitDateByPath.get(path) ?? Failure(new Error('Not Found')));
});

void mock.module('src/repositories/plugin/githubApi', () => ({
  STORE_REPO_OWNER,
  STORE_REPO_NAME,
  STORE_REPO_DEFAULT_BRANCH,
  getTree: getTreeMock,
  buildRawFileUrl,
  fetchRawText: fetchRawTextMock,
  fetchRawBinary: fetchRawBinaryMock,
  getLastCommitDateForPath: getLastCommitDateForPathMock,
}));

const { getCatalogEntries, getCatalogBinary, getCatalogIcon } = await import('../catalog');

/** プラグインマニフェスト（テスト用の最小構成）を組み立てる */
function buildManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: '11111111-1111-4111-8111-111111111111' as PluginManifest['id'],
    name: 'テストプラグイン',
    version: '1.0.0',
    description: '',
    runtime: 'wasm',
    mainFile: 'main.wasm',
    requiredHostApis: [],
    ...overrides,
  };
}

beforeEach(() => {
  treeResult = Success([]);
  fileTextByPath = new Map();
  commitDateByPath = new Map();
  getTreeMock.mockClear();
  fetchRawTextMock.mockClear();
  fetchRawBinaryMock.mockClear();
  getLastCommitDateForPathMock.mockClear();
});

describe('getCatalogEntries', () => {
  it('公開中のプラグイン一覧を取得できる', async () => {
    const manifestA = buildManifest({
      id: '11111111-1111-4111-8111-111111111111' as PluginManifest['id'],
    });
    const manifestB = buildManifest({
      id: '22222222-2222-4222-8222-222222222222' as PluginManifest['id'],
      iconFile: 'icon.png',
    });
    treeResult = Success([
      'plugins/11111111-1111-4111-8111-111111111111/plugin.json',
      'plugins/22222222-2222-4222-8222-222222222222/plugin.json',
    ]);
    fileTextByPath.set(
      'plugins/11111111-1111-4111-8111-111111111111/plugin.json',
      JSON.stringify(manifestA),
    );
    fileTextByPath.set(
      'plugins/22222222-2222-4222-8222-222222222222/plugin.json',
      JSON.stringify(manifestB),
    );
    commitDateByPath.set(
      'plugins/11111111-1111-4111-8111-111111111111/plugin.json',
      Success(new Date('2026-01-01T00:00:00Z')),
    );
    commitDateByPath.set(
      'plugins/22222222-2222-4222-8222-222222222222/plugin.json',
      Success(new Date('2026-02-01T00:00:00Z')),
    );

    const res = await getCatalogEntries('token');

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toHaveLength(2);
    const entryA = res.value.find((e) => e.manifest.id === manifestA.id);
    const entryB = res.value.find((e) => e.manifest.id === manifestB.id);
    expect(entryA?.publishedAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(entryA?.iconUrl).toBeUndefined();
    expect(entryB?.iconUrl).toBe(
      `https://raw.githubusercontent.com/${STORE_REPO_OWNER}/${STORE_REPO_NAME}/${STORE_REPO_DEFAULT_BRANCH}/plugins/22222222-2222-4222-8222-222222222222/icon.png`,
    );
  });

  it('deprecatedなプラグインは一覧から除外する', async () => {
    const manifest = buildManifest({ deprecated: true });
    treeResult = Success(['plugins/11111111-1111-4111-8111-111111111111/plugin.json']);
    fileTextByPath.set(
      'plugins/11111111-1111-4111-8111-111111111111/plugin.json',
      JSON.stringify(manifest),
    );

    const res = await getCatalogEntries();

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toHaveLength(0);
  });

  it('ディレクトリ名とmanifest.idが一致しない場合は除外する（他の正常なプラグインは返す）', async () => {
    const mismatched = buildManifest({
      id: '33333333-3333-4333-8333-333333333333' as PluginManifest['id'],
    });
    const ok = buildManifest({
      id: '44444444-4444-4444-8444-444444444444' as PluginManifest['id'],
    });
    treeResult = Success([
      'plugins/mismatched-dir/plugin.json',
      'plugins/44444444-4444-4444-8444-444444444444/plugin.json',
    ]);
    fileTextByPath.set('plugins/mismatched-dir/plugin.json', JSON.stringify(mismatched));
    fileTextByPath.set(
      'plugins/44444444-4444-4444-8444-444444444444/plugin.json',
      JSON.stringify(ok),
    );

    const res = await getCatalogEntries();

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toHaveLength(1);
    expect(res.value[0]?.manifest.id).toBe(ok.id);
  });

  it('JSONとして解析できないファイルはスキップする', async () => {
    treeResult = Success(['plugins/11111111-1111-4111-8111-111111111111/plugin.json']);
    fileTextByPath.set('plugins/11111111-1111-4111-8111-111111111111/plugin.json', '{ not json');

    const res = await getCatalogEntries();

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toHaveLength(0);
  });

  it('スキーマ検証に失敗するファイルはスキップする', async () => {
    treeResult = Success(['plugins/11111111-1111-4111-8111-111111111111/plugin.json']);
    fileTextByPath.set(
      'plugins/11111111-1111-4111-8111-111111111111/plugin.json',
      JSON.stringify({ id: 'not-a-uuid' }),
    );

    const res = await getCatalogEntries();

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toHaveLength(0);
  });

  it('plugin.json以外のファイルは走査対象にしない', async () => {
    treeResult = Success(['plugins/11111111-1111-4111-8111-111111111111/README.md', 'README.md']);

    const res = await getCatalogEntries();

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toHaveLength(0);
    expect(fetchRawTextMock).not.toHaveBeenCalled();
  });

  it('最終コミット日時の取得に失敗した場合は取得時刻へフォールバックする', async () => {
    const manifest = buildManifest();
    treeResult = Success(['plugins/11111111-1111-4111-8111-111111111111/plugin.json']);
    fileTextByPath.set(
      'plugins/11111111-1111-4111-8111-111111111111/plugin.json',
      JSON.stringify(manifest),
    );
    // commitDateByPathは未設定のまま -> getLastCommitDateForPathMockが失敗を返す

    const res = await getCatalogEntries();

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toHaveLength(1);
    expect(res.value[0]?.publishedAt).toBeInstanceOf(Date);
  });

  it('ツリー取得自体が失敗した場合はそのままFailureを返す', async () => {
    treeResult = Failure(new Error('tree fetch failed'));

    const res = await getCatalogEntries();

    expect(res.ok).toBeFalse();
    if (res.ok) return;
    expect(res.error.message).toBe('tree fetch failed');
  });
});

describe('getCatalogBinary', () => {
  it('mainFileのURLからバイナリを取得する', async () => {
    const manifest = buildManifest({ mainFile: 'main.wasm' });
    fetchRawBinaryMock.mockClear();

    const res = await getCatalogBinary(manifest);

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(Array.from(res.value)).toEqual([1, 2, 3]);
    const [url] = fetchRawBinaryMock.mock.calls.at(-1) as [string];
    expect(url).toBe(
      `https://raw.githubusercontent.com/${STORE_REPO_OWNER}/${STORE_REPO_NAME}/${STORE_REPO_DEFAULT_BRANCH}/plugins/${manifest.id}/main.wasm`,
    );
  });
});

describe('getCatalogIcon', () => {
  it('iconFile未指定の場合は取得せず失敗を返す', async () => {
    const manifest = buildManifest({ iconFile: undefined });
    fetchRawBinaryMock.mockClear();

    const res = await getCatalogIcon(manifest);

    expect(res.ok).toBeFalse();
    expect(fetchRawBinaryMock).not.toHaveBeenCalled();
  });

  it('iconFile指定時はそのURLからバイナリを取得する', async () => {
    const manifest = buildManifest({ iconFile: 'icon.png' });
    fetchRawBinaryMock.mockClear();

    const res = await getCatalogIcon(manifest);

    expect(res.ok).toBeTrue();
    const [url] = fetchRawBinaryMock.mock.calls.at(-1) as [string];
    expect(url).toBe(
      `https://raw.githubusercontent.com/${STORE_REPO_OWNER}/${STORE_REPO_NAME}/${STORE_REPO_DEFAULT_BRANCH}/plugins/${manifest.id}/icon.png`,
    );
  });
});
