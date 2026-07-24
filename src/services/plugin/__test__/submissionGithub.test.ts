import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test';
import type { Result } from 'src/models/error/result';
import { Failure, Success } from 'src/models/error/result';
import type { PluginID, PluginManifest } from 'src/models/plugin/manifest';
import type { PluginSubmissionDraft, PluginSubmissionStatus } from 'src/models/plugin/submission';

/**
 * `src/repositories/plugin/githubApi.ts`のNotFoundGithubErrorは`instanceof`判定に
 * 使われるため、モック内でも同じクラスを再現して使う
 */
class NotFoundGithubError extends Error {
  constructor(path: string) {
    super(`Not Found: ${path}`);
    this.name = 'NotFoundGithubError';
  }
}

const STORE_REPO_OWNER = 'JRC-Tojo';
const STORE_REPO_NAME = 'RD-PluginStock';
const STORE_REPO_DEFAULT_BRANCH = 'main';

/** PRのCheckRun（`gh.listCheckRuns`が返す形）を模した最小限の型 */
interface FakeCheckRun {
  name: string;
  status: string;
  conclusion: string | null;
}

/** `gh.getPullRequest`が返すPR詳細を模した最小限の型 */
interface FakePullRequestDetail {
  number: number;
  html_url: string;
  state: 'open' | 'closed';
  merged: boolean;
  head: { sha: string; ref: string; user: { login: string } };
  user: { login: string };
  created_at: string;
  updated_at: string;
  labels: { name: string }[];
}

/** PR詳細のデフォルト値を組み立てる（テストごとに必要な項目だけ上書きする） */
function buildPrDetail(overrides: {
  number: number;
  ref?: string;
  state?: 'open' | 'closed';
  merged?: boolean;
  login?: string;
}): FakePullRequestDetail {
  return {
    number: overrides.number,
    html_url: `https://github.com/pr/${overrides.number}`,
    state: overrides.state ?? 'open',
    merged: overrides.merged ?? false,
    head: {
      sha: `sha-${overrides.number}`,
      ref: overrides.ref ?? 'plugin/x',
      user: { login: overrides.login ?? 'alice' },
    },
    user: { login: overrides.login ?? 'alice' },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    labels: [],
  };
}

// ============ gh（githubApi）モック本体。デフォルト実装は既存テストの挙動を維持しつつ、
// テストごとに mockResolvedValueOnce / mockImplementation 等で挙動を差し替えられるようにする ============

const defaultGetAuthenticatedUser = () => Promise.resolve(Success({ login: 'alice' }));
const getAuthenticatedUserMock = mock<(...args: unknown[]) => Promise<Result<{ login: string }>>>(
  defaultGetAuthenticatedUser,
);

let publishedManifestJson: PluginManifest | undefined;
/** base64のデコード失敗・JSON解析失敗などの異常系を再現したい場合に、contentを直接差し替える */
let publishedManifestRawOverride: string | undefined;

const defaultGetFileContent = () => {
  if (publishedManifestRawOverride !== undefined) {
    return Promise.resolve(
      Success({ sha: 'published-sha', content: publishedManifestRawOverride }),
    );
  }
  if (!publishedManifestJson) {
    return Promise.resolve(Failure(new NotFoundGithubError('plugins/x/plugin.json')));
  }
  const content = Buffer.from(JSON.stringify(publishedManifestJson)).toString('base64');
  return Promise.resolve(Success({ sha: 'published-sha', content }));
};
const getFileContentMock = mock(defaultGetFileContent);

const defaultEnsureFork = () => Promise.resolve(Success(undefined));
const ensureForkMock = mock(defaultEnsureFork);

const defaultGetBranchSha = () => Promise.resolve(Success('base-sha'));
const getBranchShaMock = mock(defaultGetBranchSha);

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
const defaultEnsureBranch = (...args: unknown[]) => Promise.resolve(Success(undefined));
const ensureBranchMock = mock(defaultEnsureBranch);

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
const defaultPutFile = (...args: unknown[]) => Promise.resolve(Success({ sha: 'new-sha' }));
const putFileMock = mock(defaultPutFile);

const defaultFindOpenPullRequest = () =>
  Promise.resolve(Failure(new NotFoundGithubError('pulls?state=open')));
const findOpenPullRequestMock = mock<
  (...args: unknown[]) => Promise<Result<{ number: number; html_url: string }>>
>(defaultFindOpenPullRequest);

const defaultCreatePullRequest = () =>
  Promise.resolve(Success({ number: 1, html_url: 'https://github.com/pr/1' }));
const createPullRequestMock = mock(defaultCreatePullRequest);

const defaultGetPullRequest = (...args: unknown[]) =>
  Promise.resolve(Success(buildPrDetail({ number: args[2] as number })));
const getPullRequestMock =
  mock<(...args: unknown[]) => Promise<Result<FakePullRequestDetail>>>(defaultGetPullRequest);

const defaultListCheckRuns = () => Promise.resolve(Success([] as FakeCheckRun[]));
const listCheckRunsMock =
  mock<(...args: unknown[]) => Promise<Result<FakeCheckRun[]>>>(defaultListCheckRuns);

const defaultCloseIntent = () => Promise.resolve(Success(undefined));
const closePullRequestMock =
  mock<(...args: unknown[]) => Promise<Result<void>>>(defaultCloseIntent);

const defaultSearchMyPullRequestNumbers = () => Promise.resolve(Success([] as number[]));
const searchMyPullRequestNumbersMock = mock<(...args: unknown[]) => Promise<Result<number[]>>>(
  defaultSearchMyPullRequestNumbers,
);

const defaultListPullRequestFiles = () =>
  Promise.resolve(Success(['plugins/dummy/plugin.json'] as string[]));
const listPullRequestFilesMock = mock<(...args: unknown[]) => Promise<Result<string[]>>>(
  defaultListPullRequestFiles,
);

const defaultFetchRawText = () =>
  Promise.resolve(Success(JSON.stringify(buildManifest('11111111-1111-4111-8111-111111111111'))));
const fetchRawTextMock = mock<(...args: unknown[]) => Promise<Result<string>>>(defaultFetchRawText);

void mock.module('src/repositories/plugin/githubApi', () => ({
  STORE_REPO_OWNER,
  STORE_REPO_NAME,
  STORE_REPO_DEFAULT_BRANCH,
  NotFoundGithubError,
  getAuthenticatedUser: getAuthenticatedUserMock,
  getFileContent: getFileContentMock,
  ensureFork: ensureForkMock,
  getBranchSha: getBranchShaMock,
  ensureBranch: ensureBranchMock,
  putFile: putFileMock,
  findOpenPullRequest: findOpenPullRequestMock,
  createPullRequest: createPullRequestMock,
  getPullRequest: getPullRequestMock,
  listCheckRuns: listCheckRunsMock,
  closePullRequest: closePullRequestMock,
  searchMyPullRequestNumbers: searchMyPullRequestNumbersMock,
  listPullRequestFiles: listPullRequestFilesMock,
  fetchRawText: fetchRawTextMock,
  buildRawFileUrl: (owner: string, repo: string, ref: string, path: string) =>
    `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`,
}));

// ============ pluginDb（src/repositories/db/plugin）モック。非表示（dismiss）関連のみ使用する ============

const defaultGetDismissedSubmissionPrNumbers = () => Promise.resolve(Success([] as number[]));
const getDismissedSubmissionPrNumbersMock = mock<(...args: unknown[]) => Promise<Result<number[]>>>(
  defaultGetDismissedSubmissionPrNumbers,
);

const defaultDismissSubmission = () => Promise.resolve(Success(undefined));
const dismissSubmissionMock = mock(defaultDismissSubmission);

void mock.module('src/repositories/db/plugin', () => ({
  getDismissedSubmissionPrNumbers: getDismissedSubmissionPrNumbersMock,
  dismissSubmission: dismissSubmissionMock,
}));

const { submitPlugin, getSubmissions, dismissSubmission, withdrawSubmission, unpublishPlugin } =
  await import('../submissionGithub');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_A = '44444444-4444-4444-8444-444444444444';
const UUID_B = '55555555-5555-4555-8555-555555555555';

function buildManifest(id: string): PluginManifest {
  return {
    id: id as PluginManifest['id'],
    name: 'テストプラグイン',
    version: '1.0.0',
    description: '',
    runtime: 'wasm',
    mainFile: 'test.wasm',
    requiredHostApis: [],
  };
}

/** フォーム入力相当（id/ownerを持たない）のドラフトを組み立てる */
function buildDraft(overrides: Partial<PluginSubmissionDraft> = {}): PluginSubmissionDraft {
  return {
    name: 'テストプラグイン',
    version: '1.0.0',
    description: '',
    runtime: 'wasm',
    mainFile: 'test.wasm',
    requiredHostApis: [],
    ...overrides,
  };
}

/** `putFile`で送信されたplugin.jsonの内容（base64→JSON）を取り出す */
function decodeSubmittedManifest(): PluginManifest {
  const call = putFileMock.mock.calls.find((c) => String(c[2]).endsWith('plugin.json'));
  if (!call) throw new Error('plugin.jsonへのputFile呼び出しが見つかりません');
  return JSON.parse(Buffer.from(String(call[4]), 'base64').toString('utf-8')) as PluginManifest;
}

/**
 * `waitAndBuildSubmission`のリトライ待機（初回2000ms＋最大6回のリトライ）を実時間で待つと
 * テストが遅くなりすぎるため、`setTimeout`をコールバック即時実行に差し替える。
 * `src/repositories/plugin/__test__/githubApi.test.ts`の`ensureFork`テストと同じ手法だが、
 * このファイルではほぼ全テストが`submitPlugin`/`unpublishPlugin`（内部で待機する）経由のため
 * ファイル全体に適用する
 */
const originalSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((fn: () => void) => {
  fn();
  return 0 as unknown as ReturnType<typeof setTimeout>;
}) as typeof setTimeout;

/** 各テスト後にモックの呼び出し履歴・実装差し替えをすべてデフォルトへ戻す */
afterEach(() => {
  publishedManifestJson = undefined;
  publishedManifestRawOverride = undefined;

  getAuthenticatedUserMock.mockReset();
  getAuthenticatedUserMock.mockImplementation(defaultGetAuthenticatedUser);

  getFileContentMock.mockReset();
  getFileContentMock.mockImplementation(defaultGetFileContent);

  ensureForkMock.mockReset();
  ensureForkMock.mockImplementation(defaultEnsureFork);

  getBranchShaMock.mockReset();
  getBranchShaMock.mockImplementation(defaultGetBranchSha);

  ensureBranchMock.mockReset();
  ensureBranchMock.mockImplementation(defaultEnsureBranch);

  putFileMock.mockReset();
  putFileMock.mockImplementation(defaultPutFile);

  findOpenPullRequestMock.mockReset();
  findOpenPullRequestMock.mockImplementation(defaultFindOpenPullRequest);

  createPullRequestMock.mockReset();
  createPullRequestMock.mockImplementation(defaultCreatePullRequest);

  getPullRequestMock.mockReset();
  getPullRequestMock.mockImplementation(defaultGetPullRequest);

  listCheckRunsMock.mockReset();
  listCheckRunsMock.mockImplementation(defaultListCheckRuns);

  closePullRequestMock.mockReset();
  closePullRequestMock.mockImplementation(defaultCloseIntent);

  searchMyPullRequestNumbersMock.mockReset();
  searchMyPullRequestNumbersMock.mockImplementation(defaultSearchMyPullRequestNumbers);

  listPullRequestFilesMock.mockReset();
  listPullRequestFilesMock.mockImplementation(defaultListPullRequestFiles);

  fetchRawTextMock.mockReset();
  fetchRawTextMock.mockImplementation(defaultFetchRawText);

  getDismissedSubmissionPrNumbersMock.mockReset();
  getDismissedSubmissionPrNumbersMock.mockImplementation(defaultGetDismissedSubmissionPrNumbers);

  dismissSubmissionMock.mockReset();
  dismissSubmissionMock.mockImplementation(defaultDismissSubmission);
});

describe('submitPlugin（id自動採番）', () => {
  it('新規申請（updateId省略）時は、UUIDを新規採番する', async () => {
    publishedManifestJson = undefined;

    const draft = buildDraft();

    const res = await submitPlugin(draft, new Uint8Array([1, 2, 3]), undefined, 'token');
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const submitted = decodeSubmittedManifest();
    expect(String(submitted.id)).toMatch(UUID_PATTERN);
    expect(res.value.manifest.id).toBe(submitted.id);

    // ブランチ名・PR本文にも新規採番後のidが使われていること
    const branchArg = ensureBranchMock.mock.calls[0]?.[2];
    expect(branchArg).toBe(`plugin/${submitted.id}`);
  });

  it('updateIdを指定した更新申請時は、そのidをそのまま使う（新規採番しない）', async () => {
    const publishedId = '11111111-1111-4111-8111-111111111111';
    publishedManifestJson = { ...buildManifest(publishedId), owner: 'alice' };

    const draft = buildDraft({ version: '1.1.0' });
    const res = await submitPlugin(
      draft,
      new Uint8Array([1, 2, 3]),
      undefined,
      'token',
      publishedId as PluginID,
    );
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const submitted = decodeSubmittedManifest();
    expect(String(submitted.id)).toBe(publishedId);
    expect(String(res.value.manifest.id)).toBe(publishedId);
  });

  it('公開済みのownerと申請者が異なる場合は拒否し、pushも行わない', async () => {
    const publishedId = '22222222-2222-4222-8222-222222222222';
    publishedManifestJson = { ...buildManifest(publishedId), owner: 'bob' };

    const draft = buildDraft();
    const res = await submitPlugin(
      draft,
      new Uint8Array([1, 2, 3]),
      undefined,
      'token',
      publishedId as PluginID,
    );
    expect(res.ok).toBeFalse();
    expect(putFileMock).not.toHaveBeenCalled();
  });

  it('updateIdに対応する公開済みプラグインが見つからない場合は拒否する', async () => {
    publishedManifestJson = undefined;

    const draft = buildDraft();
    const res = await submitPlugin(
      draft,
      new Uint8Array([1, 2, 3]),
      undefined,
      'token',
      '33333333-3333-4333-8333-333333333333' as PluginID,
    );
    expect(res.ok).toBeFalse();
    expect(putFileMock).not.toHaveBeenCalled();
  });
});

describe('waitAndBuildSubmission（submitPlugin経由でのリトライ・フォールバック分岐）', () => {
  it('gh.getPullRequestが常に404を返し続ける場合は、pendingの暫定Submissionを返す', async () => {
    getPullRequestMock.mockImplementation(() =>
      Promise.resolve(Failure(new NotFoundGithubError('pulls/1'))),
    );

    const draft = buildDraft();
    const res = await submitPlugin(draft, new Uint8Array([1, 2, 3]), undefined, 'token');

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.status).toBe('pending');
    expect(res.value.checks).toEqual([]);
    expect(res.value.prNumber).toBe(1);
    // 初回delay=0 + リトライ6回 = 計7回試行して諦める
    expect(getPullRequestMock).toHaveBeenCalledTimes(7);
  });

  it('数回404が続いた後に成功する場合は、そのSubmissionを返す', async () => {
    let callCount = 0;
    getPullRequestMock.mockImplementation(() => {
      callCount++;
      if (callCount < 3) return Promise.resolve(Failure(new NotFoundGithubError('pulls/1')));
      return Promise.resolve(Success(buildPrDetail({ number: 1 })));
    });

    const draft = buildDraft();
    const res = await submitPlugin(draft, new Uint8Array([1, 2, 3]), undefined, 'token');

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.prNumber).toBe(1);
    expect(getPullRequestMock).toHaveBeenCalledTimes(3);
  });

  it('404以外のエラーが返った場合は即座に伝播し、リトライしない', async () => {
    getPullRequestMock.mockImplementation(() =>
      Promise.resolve(Failure(new Error('server error'))),
    );

    const draft = buildDraft();
    const res = await submitPlugin(draft, new Uint8Array([1, 2, 3]), undefined, 'token');

    expect(res.ok).toBeFalse();
    if (res.ok) return;
    expect(res.error.message).toBe('server error');
    expect(getPullRequestMock).toHaveBeenCalledTimes(1);
  });
});

describe('getSubmissions', () => {
  it('gh.getAuthenticatedUserが失敗した場合は伝播する', async () => {
    getAuthenticatedUserMock.mockResolvedValueOnce(Failure(new Error('auth error')));

    const res = await getSubmissions('token');
    expect(res.ok).toBeFalse();
    if (res.ok) return;
    expect(res.error.message).toBe('auth error');
  });

  it('gh.searchMyPullRequestNumbersが失敗した場合は伝播する', async () => {
    searchMyPullRequestNumbersMock.mockResolvedValueOnce(Failure(new Error('search error')));

    const res = await getSubmissions('token');
    expect(res.ok).toBeFalse();
    if (res.ok) return;
    expect(res.error.message).toBe('search error');
  });

  it('非表示化(dismiss)されたPR番号は結果一覧から除外される', async () => {
    searchMyPullRequestNumbersMock.mockResolvedValueOnce(Success([10, 20]));
    getDismissedSubmissionPrNumbersMock.mockResolvedValueOnce(Success([20]));
    getPullRequestMock.mockResolvedValueOnce(Success(buildPrDetail({ number: 10 })));
    listPullRequestFilesMock.mockResolvedValueOnce(Success([`plugins/${UUID_A}/plugin.json`]));
    fetchRawTextMock.mockResolvedValueOnce(Success(JSON.stringify(buildManifest(UUID_A))));

    const res = await getSubmissions('token');
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.map((s) => s.prNumber)).toEqual([10]);
    // 20番は除外されるためgetPullRequestは1回しか呼ばれない
    expect(getPullRequestMock).toHaveBeenCalledTimes(1);
  });

  it('pluginDb.getDismissedSubmissionPrNumbersが失敗した場合は、除外なし（空配列扱い）として処理する', async () => {
    searchMyPullRequestNumbersMock.mockResolvedValueOnce(Success([30]));
    getDismissedSubmissionPrNumbersMock.mockResolvedValueOnce(Failure(new Error('db error')));
    getPullRequestMock.mockResolvedValueOnce(Success(buildPrDetail({ number: 30 })));
    listPullRequestFilesMock.mockResolvedValueOnce(Success([`plugins/${UUID_A}/plugin.json`]));
    fetchRawTextMock.mockResolvedValueOnce(Success(JSON.stringify(buildManifest(UUID_A))));

    const res = await getSubmissions('token');
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toHaveLength(1);
    expect(res.value[0]?.prNumber).toBe(30);
  });

  it('個別PRの取得(gh.getPullRequest)が失敗した場合はそのPRをスキップする', async () => {
    searchMyPullRequestNumbersMock.mockResolvedValueOnce(Success([1]));
    getPullRequestMock.mockResolvedValueOnce(Failure(new Error('pr fetch error')));

    const res = await getSubmissions('token');
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toEqual([]);
  });

  it('PRの変更ファイル一覧取得(gh.listPullRequestFiles)が失敗した場合はそのPRをスキップする', async () => {
    searchMyPullRequestNumbersMock.mockResolvedValueOnce(Success([2]));
    getPullRequestMock.mockResolvedValueOnce(Success(buildPrDetail({ number: 2 })));
    listPullRequestFilesMock.mockResolvedValueOnce(Failure(new Error('files error')));

    const res = await getSubmissions('token');
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toEqual([]);
  });

  it('plugins/<id>/plugin.jsonに該当する変更ファイルが無い場合はそのPRをスキップする', async () => {
    searchMyPullRequestNumbersMock.mockResolvedValueOnce(Success([3]));
    getPullRequestMock.mockResolvedValueOnce(Success(buildPrDetail({ number: 3 })));
    listPullRequestFilesMock.mockResolvedValueOnce(Success(['README.md']));

    const res = await getSubmissions('token');
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toEqual([]);
  });

  it('マニフェストのraw取得(gh.fetchRawText)が失敗した場合はそのPRをスキップする', async () => {
    searchMyPullRequestNumbersMock.mockResolvedValueOnce(Success([4]));
    getPullRequestMock.mockResolvedValueOnce(Success(buildPrDetail({ number: 4 })));
    listPullRequestFilesMock.mockResolvedValueOnce(Success([`plugins/${UUID_A}/plugin.json`]));
    fetchRawTextMock.mockResolvedValueOnce(Failure(new Error('raw fetch error')));

    const res = await getSubmissions('token');
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toEqual([]);
  });

  it('取得したテキストがJSONとして解析できない場合はそのPRをスキップする', async () => {
    searchMyPullRequestNumbersMock.mockResolvedValueOnce(Success([5]));
    getPullRequestMock.mockResolvedValueOnce(Success(buildPrDetail({ number: 5 })));
    listPullRequestFilesMock.mockResolvedValueOnce(Success([`plugins/${UUID_A}/plugin.json`]));
    fetchRawTextMock.mockResolvedValueOnce(Success('{ invalid json'));

    const res = await getSubmissions('token');
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toEqual([]);
  });

  it('取得したJSONがPluginManifestとして不正な場合はそのPRをスキップする', async () => {
    searchMyPullRequestNumbersMock.mockResolvedValueOnce(Success([6]));
    getPullRequestMock.mockResolvedValueOnce(Success(buildPrDetail({ number: 6 })));
    listPullRequestFilesMock.mockResolvedValueOnce(Success([`plugins/${UUID_A}/plugin.json`]));
    fetchRawTextMock.mockResolvedValueOnce(Success(JSON.stringify({ foo: 'bar' })));

    const res = await getSubmissions('token');
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toEqual([]);
  });

  it('headブランチがunpublish/で始まる場合はkind:unpublish、それ以外はkind:submitになる。一部PRがスキップされても残りは結果に含まれる', async () => {
    searchMyPullRequestNumbersMock.mockResolvedValueOnce(Success([7, 8, 9]));
    getPullRequestMock
      .mockResolvedValueOnce(Success(buildPrDetail({ number: 7, ref: 'plugin/x' })))
      .mockResolvedValueOnce(Failure(new Error('skip me')))
      .mockResolvedValueOnce(Success(buildPrDetail({ number: 9, ref: 'unpublish/x' })));
    listPullRequestFilesMock
      .mockResolvedValueOnce(Success([`plugins/${UUID_A}/plugin.json`]))
      .mockResolvedValueOnce(Success([`plugins/${UUID_A}/plugin.json`]));
    fetchRawTextMock
      .mockResolvedValueOnce(Success(JSON.stringify(buildManifest(UUID_A))))
      .mockResolvedValueOnce(Success(JSON.stringify(buildManifest(UUID_A))));

    const res = await getSubmissions('token');
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toHaveLength(2);
    expect(res.value[0]?.prNumber).toBe(7);
    expect(res.value[0]?.kind).toBe('submit');
    expect(res.value[1]?.prNumber).toBe(9);
    expect(res.value[1]?.kind).toBe('unpublish');
  });
});

describe('deriveStatus（getSubmissionsを通した間接テスト）', () => {
  const cases: {
    label: string;
    pr: { state?: 'open' | 'closed'; merged?: boolean };
    checks: FakeCheckRun[];
    expectedStatus: PluginSubmissionStatus;
  }[] = [
    {
      label: 'マージ済みの場合はpublished',
      pr: { merged: true },
      checks: [],
      expectedStatus: 'published',
    },
    {
      label: 'マージされずにクローズされた場合はwithdrawn',
      pr: { state: 'closed', merged: false },
      checks: [],
      expectedStatus: 'withdrawn',
    },
    {
      label: 'Checksが1件も無い場合はpending',
      pr: {},
      checks: [],
      expectedStatus: 'pending',
    },
    {
      label: 'いずれかのCheckがfailureの場合はci_failed',
      pr: {},
      checks: [{ name: 'ci', status: 'completed', conclusion: 'failure' }],
      expectedStatus: 'ci_failed',
    },
    {
      label: 'いずれかのCheckがtimed_outの場合もci_failed',
      pr: {},
      checks: [{ name: 'ci', status: 'completed', conclusion: 'timed_out' }],
      expectedStatus: 'ci_failed',
    },
    {
      label: '全Checkが完了(conclusionがnullでない)場合はci_passed',
      pr: {},
      checks: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
      expectedStatus: 'ci_passed',
    },
    {
      label: '一部のCheckが未完了(conclusion:null)の場合はpending',
      pr: {},
      checks: [{ name: 'ci', status: 'in_progress', conclusion: null }],
      expectedStatus: 'pending',
    },
  ];

  for (const c of cases) {
    it(c.label, async () => {
      searchMyPullRequestNumbersMock.mockResolvedValueOnce(Success([100]));
      getPullRequestMock.mockResolvedValueOnce(Success(buildPrDetail({ number: 100, ...c.pr })));
      listPullRequestFilesMock.mockResolvedValueOnce(Success([`plugins/${UUID_A}/plugin.json`]));
      fetchRawTextMock.mockResolvedValueOnce(Success(JSON.stringify(buildManifest(UUID_A))));
      listCheckRunsMock.mockResolvedValueOnce(Success(c.checks));

      const res = await getSubmissions('token');
      expect(res.ok).toBeTrue();
      if (!res.ok) return;
      expect(res.value[0]?.status).toBe(c.expectedStatus);
    });
  }
});

describe('dismissSubmission / withdrawSubmission（委譲関数）', () => {
  it('dismissSubmissionはpluginDb.dismissSubmissionへ委譲し、結果をそのまま返す', async () => {
    dismissSubmissionMock.mockResolvedValueOnce(Success(undefined));

    const res = await dismissSubmission(123);
    expect(res.ok).toBeTrue();
    expect(dismissSubmissionMock).toHaveBeenCalledWith(123);
  });

  it('withdrawSubmissionはgh.closePullRequestへストアリポジトリ・PR番号・トークンを渡して委譲する', async () => {
    closePullRequestMock.mockResolvedValueOnce(Success(undefined));

    const res = await withdrawSubmission(456, 'token');
    expect(res.ok).toBeTrue();
    expect(closePullRequestMock).toHaveBeenCalledWith(
      STORE_REPO_OWNER,
      STORE_REPO_NAME,
      456,
      'token',
    );
  });

  it('gh.closePullRequestが失敗した場合はそのままFailureを返す', async () => {
    closePullRequestMock.mockResolvedValueOnce(Failure(new Error('close error')));

    const res = await withdrawSubmission(789, 'token');
    expect(res.ok).toBeFalse();
  });
});

describe('unpublishPlugin', () => {
  it('gh.getAuthenticatedUserが失敗した場合は伝播する', async () => {
    getAuthenticatedUserMock.mockResolvedValueOnce(Failure(new Error('auth error')));

    const res = await unpublishPlugin('some-id', 'token');
    expect(res.ok).toBeFalse();
    if (res.ok) return;
    expect(res.error.message).toBe('auth error');
  });

  it('公開済みのマニフェストが見つからない場合は「公開済みのプラグインが見つかりません」で失敗する', async () => {
    publishedManifestJson = undefined;

    const res = await unpublishPlugin('missing-id', 'token');
    expect(res.ok).toBeFalse();
    if (res.ok) return;
    expect(res.error.message).toBe('公開済みのプラグインが見つかりません');
  });

  it('公開済みのownerと申請者が一致しない場合は取り下げを拒否する', async () => {
    publishedManifestJson = { ...buildManifest(UUID_A), owner: 'bob' };

    const res = await unpublishPlugin(UUID_A, 'token');
    expect(res.ok).toBeFalse();
    if (res.ok) return;
    expect(res.error.message).toBe('このプラグインの取り下げは、公開したユーザーのみ行えます');
  });

  it('正常系：deprecated:trueのmanifestが固定ブランチ名unpublish/<id>へpushされ、PRが新規作成される', async () => {
    publishedManifestJson = { ...buildManifest(UUID_A), owner: 'alice' };
    findOpenPullRequestMock.mockResolvedValueOnce(
      Failure(new NotFoundGithubError('pulls?state=open')),
    );

    const res = await unpublishPlugin(UUID_A, 'token');
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const branchArg = ensureBranchMock.mock.calls[0]?.[2];
    expect(branchArg).toBe(`unpublish/${UUID_A}`);

    const submittedManifest = decodeSubmittedManifest();
    expect(submittedManifest.deprecated).toBeTrue();
    expect(String(submittedManifest.id)).toBe(UUID_A);

    expect(createPullRequestMock).toHaveBeenCalledTimes(1);
    expect(res.value.kind).toBe('unpublish');
  });

  it('既に開いている取り下げPRがある場合はそれを再利用し、新規作成しない', async () => {
    publishedManifestJson = { ...buildManifest(UUID_B), owner: 'alice' };
    findOpenPullRequestMock.mockResolvedValueOnce(
      Success({ number: 77, html_url: 'https://github.com/pr/77' }),
    );

    const res = await unpublishPlugin(UUID_B, 'token');
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.prNumber).toBe(77);
    expect(createPullRequestMock).not.toHaveBeenCalled();
  });
});

describe('fetchPublishedManifest（submitPlugin/unpublishPlugin経由での間接テスト）', () => {
  it('gh.getFileContentのcontentが不正なbase64の場合はFailureを返す', async () => {
    publishedManifestRawOverride = '!!!invalid-base64!!!';

    const res = await unpublishPlugin('some-id', 'token');
    expect(res.ok).toBeFalse();
  });

  it('base64は正しいがJSONとして解析できない場合はFailureを返す', async () => {
    publishedManifestRawOverride = Buffer.from('not a json content').toString('base64');

    const res = await unpublishPlugin('some-id', 'token');
    expect(res.ok).toBeFalse();
  });

  it('base64・JSONとしては正しいがPluginManifestとして不正な場合はFailureを返す', async () => {
    publishedManifestRawOverride = Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64');

    const res = await unpublishPlugin('some-id', 'token');
    expect(res.ok).toBeFalse();
  });

  it('gh.getFileContentが404以外のエラーを返した場合はそのまま伝播する', async () => {
    getFileContentMock.mockResolvedValueOnce(Failure(new Error('file content error')));

    const res = await unpublishPlugin('some-id', 'token');
    expect(res.ok).toBeFalse();
    if (res.ok) return;
    expect(res.error.message).toBe('file content error');
  });
});

// このファイルの全テスト完了後にsetTimeoutを元に戻す（他のテストファイルへ影響させないため）
afterAll(() => {
  globalThis.setTimeout = originalSetTimeout;
});
