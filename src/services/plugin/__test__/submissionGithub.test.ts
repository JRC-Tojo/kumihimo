import { describe, expect, it, mock } from 'bun:test';
import { Failure, Success } from 'src/models/error/result';
import type { PluginID, PluginManifest } from 'src/models/plugin/manifest';
import type { PluginSubmissionDraft } from 'src/models/plugin/submission';

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
const putFileMock = mock((...args: unknown[]) => Promise.resolve(Success({ sha: 'new-sha' })));
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
const ensureBranchMock = mock((...args: unknown[]) => Promise.resolve(Success(undefined)));
const createPullRequestMock = mock(() =>
  Promise.resolve(Success({ number: 1, html_url: 'https://github.com/pr/1' })),
);

let publishedManifestJson: PluginManifest | undefined;

void mock.module('src/repositories/plugin/githubApi', () => ({
  STORE_REPO_OWNER,
  STORE_REPO_NAME,
  STORE_REPO_DEFAULT_BRANCH,
  NotFoundGithubError,
  getAuthenticatedUser: () => Promise.resolve(Success({ login: 'alice' })),
  getFileContent: () => {
    if (!publishedManifestJson) {
      return Promise.resolve(Failure(new NotFoundGithubError('plugins/x/plugin.json')));
    }
    const content = Buffer.from(JSON.stringify(publishedManifestJson)).toString('base64');
    return Promise.resolve(Success({ sha: 'published-sha', content }));
  },
  ensureFork: () => Promise.resolve(Success(undefined)),
  getBranchSha: () => Promise.resolve(Success('base-sha')),
  ensureBranch: ensureBranchMock,
  putFile: putFileMock,
  findOpenPullRequest: () => Promise.resolve(Failure(new NotFoundGithubError('pulls?state=open'))),
  createPullRequest: createPullRequestMock,
  getPullRequest: () =>
    Promise.resolve(
      Success({
        number: 1,
        html_url: 'https://github.com/pr/1',
        state: 'open' as const,
        merged: false,
        head: { sha: 'head-sha', ref: 'plugin/x', user: { login: 'alice' } },
        user: { login: 'alice' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        labels: [],
      }),
    ),
  listCheckRuns: () => Promise.resolve(Success([])),
}));

const { submitPlugin } = await import('../submissionGithub');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

describe('submitPlugin（id自動採番）', () => {
  it('新規申請（updateId省略）時は、UUIDを新規採番する', async () => {
    publishedManifestJson = undefined;
    putFileMock.mockClear();
    ensureBranchMock.mockClear();
    createPullRequestMock.mockClear();

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
    putFileMock.mockClear();
    ensureBranchMock.mockClear();

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
    putFileMock.mockClear();

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
    putFileMock.mockClear();

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
