/**
 * githubApi.ts の単体テスト
 *
 * 実際のGitHubへは通信せず、`globalThis.fetch`をモックに差し替えて検証する。
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  STORE_REPO_OWNER,
  STORE_REPO_NAME,
  NotFoundGithubError,
  getAuthenticatedUser,
  getRepo,
  ensureFork,
  getBranchSha,
  ensureBranch,
  getFileContent,
  putFile,
  findOpenPullRequest,
  createPullRequest,
  getPullRequest,
  mergePullRequest,
  closePullRequest,
  createIssueComment,
  listCheckRuns,
  listPullRequestFiles,
  searchMyPullRequestNumbers,
  getTree,
  getLastCommitDateForPath,
  buildRawFileUrl,
  fetchRawText,
  fetchRawBinary,
} from '../githubApi';

/** fetchのレスポンスを模したオブジェクトを組み立てる */
function fakeResponse(
  status: number,
  body?: unknown,
  options: { asText?: boolean; arrayBuffer?: ArrayBuffer } = {},
): Response {
  const textBody = options.asText ? (body as string) : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(textBody),
    arrayBuffer: () => Promise.resolve(options.arrayBuffer ?? new ArrayBuffer(0)),
  } as unknown as Response;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
const fetchMock = mock((...args: unknown[]) => Promise.resolve(fakeResponse(200, {})));
const originalFetch = globalThis.fetch;

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** 直近のfetch呼び出しの引数（URL・RequestInit）を取り出す */
function lastFetchCall(): [string, RequestInit | undefined] {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error('fetchが呼び出されていません');
  return call as [string, RequestInit | undefined];
}

describe('githubRequest（各関数経由での共通挙動）', () => {
  it('トークンを渡すとAuthorizationヘッダーが付与される', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, { login: 'alice' }));
    await getAuthenticatedUser('my-token');

    const [url, init] = lastFetchCall();
    expect(url).toBe('https://api.github.com/user');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer my-token');
    expect(headers.Accept).toBe('application/vnd.github+json');
  });

  it('トークン未指定時はAuthorizationヘッダーが付与されない', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, { default_branch: 'main' }));
    await getRepo('owner', 'repo');

    const [, init] = lastFetchCall();
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('404の場合はNotFoundGithubErrorを返す', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(404));
    const res = await getRepo('owner', 'missing-repo', 'token');

    expect(res.ok).toBeFalse();
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(NotFoundGithubError);
  });

  it('404以外のエラー応答はレスポンス本文を含むErrorを返す', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(500, 'internal error', { asText: true }));
    const res = await getRepo('owner', 'repo', 'token');

    expect(res.ok).toBeFalse();
    if (res.ok) return;
    expect(res.error).not.toBeInstanceOf(NotFoundGithubError);
    expect(res.error.message).toContain('500');
    expect(res.error.message).toContain('internal error');
  });

  it('fetch自体が例外を投げた場合はFailureとして返す', async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('network down')));
    const res = await getRepo('owner', 'repo');

    expect(res.ok).toBeFalse();
    if (res.ok) return;
    expect(res.error.message).toBe('network down');
  });

  it('204 No Contentの場合はundefinedとしてSuccessを返す', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(204));
    const res = await mergePullRequest('owner', 'repo', 1, 'token');

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toBeUndefined();
  });
});

describe('getAuthenticatedUser', () => {
  it('ユーザー情報を取得できる', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, { login: 'alice' }));
    const res = await getAuthenticatedUser('token');

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.login).toBe('alice');
  });
});

describe('getRepo', () => {
  it('リポジトリの基本情報を取得できる', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, { default_branch: 'main' }));
    const res = await getRepo('owner', 'repo');

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.default_branch).toBe('main');
    const [url] = lastFetchCall();
    expect(url).toBe('https://api.github.com/repos/owner/repo');
  });
});

describe('ensureFork', () => {
  // フォーク作成後のポーリング待機（1500ms x 最大10回）を高速化するため、
  // このdescribe内でのみsetTimeoutを即時実行に差し替える
  const originalSetTimeout = globalThis.setTimeout;

  beforeEach(() => {
    globalThis.setTimeout = ((fn: () => void) => {
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
  });

  afterEach(() => {
    globalThis.setTimeout = originalSetTimeout;
  });

  it('フォークが既に存在する場合は何もせず成功する', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, { default_branch: 'main' }));
    const res = await ensureFork('token', 'alice');

    expect(res.ok).toBeTrue();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('フォークが存在しない場合は作成し、参照可能になるまで確認する', async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(404)) // 存在確認 -> 無い
      .mockResolvedValueOnce(fakeResponse(202, {})) // フォーク作成
      .mockResolvedValueOnce(fakeResponse(404)) // 1回目の確認はまだ準備中
      .mockResolvedValueOnce(fakeResponse(200, { default_branch: 'main' })); // 2回目で成功

    const res = await ensureFork('token', 'alice');

    expect(res.ok).toBeTrue();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('存在確認で404以外のエラーが起きた場合はそのまま返す', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(500, 'boom', { asText: true }));
    const res = await ensureFork('token', 'alice');

    expect(res.ok).toBeFalse();
  });

  it('フォーク作成リクエスト自体が失敗した場合はそのまま返す', async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(404))
      .mockResolvedValueOnce(fakeResponse(403, 'forbidden', { asText: true }));

    const res = await ensureFork('token', 'alice');

    expect(res.ok).toBeFalse();
    if (res.ok) return;
    expect(res.error.message).toContain('403');
  });

  it('規定回数確認しても準備が完了しない場合は専用エラーで失敗する', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(404)).mockResolvedValueOnce(fakeResponse(202, {}));
    fetchMock.mockResolvedValue(fakeResponse(404));

    const res = await ensureFork('token', 'alice');

    expect(res.ok).toBeFalse();
    if (res.ok) return;
    expect(res.error.message).toContain('フォークの作成完了');
  });
});

describe('getBranchSha', () => {
  it('ブランチ先頭のSHAを取得できる', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, { object: { sha: 'abc123' } }));
    const res = await getBranchSha('owner', 'repo', 'main');

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toBe('abc123');
  });

  it('存在しないブランチはNotFoundGithubErrorになる', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(404));
    const res = await getBranchSha('owner', 'repo', 'missing');

    expect(res.ok).toBeFalse();
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(NotFoundGithubError);
  });
});

describe('ensureBranch', () => {
  it('ブランチが既に存在する場合は何もせず成功する', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, { object: { sha: 'existing-sha' } }));
    const res = await ensureBranch('owner', 'repo', 'feature', 'base-sha', 'token');

    expect(res.ok).toBeTrue();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ブランチが存在しない場合は作成する', async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(404))
      .mockResolvedValueOnce(fakeResponse(201, { object: { sha: 'base-sha' } }));

    const res = await ensureBranch('owner', 'repo', 'feature', 'base-sha', 'token');

    expect(res.ok).toBeTrue();
    const [url, init] = lastFetchCall();
    expect(url).toBe('https://api.github.com/repos/owner/repo/git/refs');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      ref: 'refs/heads/feature',
      sha: 'base-sha',
    });
  });

  it('存在確認で404以外のエラーが起きた場合はそのまま返す', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(500, 'boom', { asText: true }));
    const res = await ensureBranch('owner', 'repo', 'feature', 'base-sha', 'token');

    expect(res.ok).toBeFalse();
  });
});

describe('getFileContent / putFile', () => {
  it('ファイル内容を取得できる（refがクエリに反映される）', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, { sha: 'file-sha', content: 'aGVsbG8=' }));
    const res = await getFileContent('owner', 'repo', 'plugins/x/plugin.json', 'feature/branch');

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.content).toBe('aGVsbG8=');
    const [url] = lastFetchCall();
    expect(url).toBe(
      'https://api.github.com/repos/owner/repo/contents/plugins/x/plugin.json?ref=feature%2Fbranch',
    );
  });

  it('存在しないファイルはNotFoundGithubErrorになる', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(404));
    const res = await getFileContent('owner', 'repo', 'plugins/x/plugin.json', 'main');

    expect(res.ok).toBeFalse();
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(NotFoundGithubError);
  });

  it('putFileはPUTでコミット情報を送信する', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(201, { content: { sha: 'new-sha' } }));
    const res = await putFile(
      'owner',
      'repo',
      'plugins/x/plugin.json',
      'feature',
      'aGVsbG8=',
      'update plugin.json',
      'token',
      'old-sha',
    );

    expect(res.ok).toBeTrue();
    const [url, init] = lastFetchCall();
    expect(url).toBe('https://api.github.com/repos/owner/repo/contents/plugins/x/plugin.json');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(init?.body as string)).toEqual({
      message: 'update plugin.json',
      content: 'aGVsbG8=',
      branch: 'feature',
      sha: 'old-sha',
    });
  });
});

describe('findOpenPullRequest / createPullRequest', () => {
  it('該当するオープンPRが見つかる', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, [{ number: 5, html_url: 'https://github.com/pr/5' }]),
    );
    const res = await findOpenPullRequest('owner', 'repo', 'alice', 'plugin/x', 'token');

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.number).toBe(5);
    const [url] = lastFetchCall();
    expect(url).toContain(encodeURIComponent('alice:plugin/x'));
  });

  it('該当するPRが無い場合はNotFoundGithubErrorになる', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, []));
    const res = await findOpenPullRequest('owner', 'repo', 'alice', 'plugin/x');

    expect(res.ok).toBeFalse();
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(NotFoundGithubError);
  });

  it('createPullRequestはPOSTでPRを作成する', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, { number: 9, html_url: 'https://github.com/pr/9' }),
    );
    const res = await createPullRequest(
      'owner',
      'repo',
      { title: 'title', body: 'body', head: 'alice:plugin/x', base: 'main' },
      'token',
    );

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.number).toBe(9);
    const [, init] = lastFetchCall();
    expect(init?.method).toBe('POST');
  });
});

describe('getPullRequest / mergePullRequest / closePullRequest', () => {
  it('PR詳細を取得できる', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, {
        number: 1,
        html_url: 'https://github.com/pr/1',
        state: 'open',
        merged: false,
        head: { sha: 'sha', ref: 'plugin/x', user: { login: 'alice' } },
        user: { login: 'alice' },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        labels: [],
      }),
    );
    const res = await getPullRequest('owner', 'repo', 1);

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.state).toBe('open');
  });

  it('mergePullRequestはPUTでマージする', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, { merged: true }));
    const res = await mergePullRequest('owner', 'repo', 1, 'token');

    expect(res.ok).toBeTrue();
    const [url, init] = lastFetchCall();
    expect(url).toBe('https://api.github.com/repos/owner/repo/pulls/1/merge');
    expect(init?.method).toBe('PUT');
  });

  it('closePullRequestはPATCHでstateをclosedにする', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, {}));
    const res = await closePullRequest('owner', 'repo', 1, 'token');

    expect(res.ok).toBeTrue();
    const [, init] = lastFetchCall();
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(init?.body as string)).toEqual({ state: 'closed' });
  });
});

describe('createIssueComment', () => {
  it('コメントを投稿する', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(201, {}));
    const res = await createIssueComment('owner', 'repo', 1, 'コメント本文', 'token');

    expect(res.ok).toBeTrue();
    const [url, init] = lastFetchCall();
    expect(url).toBe('https://api.github.com/repos/owner/repo/issues/1/comments');
    expect(JSON.parse(init?.body as string)).toEqual({ body: 'コメント本文' });
  });
});

describe('listCheckRuns', () => {
  it('Checks一覧を取得できる', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, {
        check_runs: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
      }),
    );
    const res = await listCheckRuns('owner', 'repo', 'sha');

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toEqual([{ name: 'ci', status: 'completed', conclusion: 'success' }]);
  });
});

describe('listPullRequestFiles', () => {
  it('変更ファイル一覧をファイル名の配列として取得できる', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, [
        { filename: 'plugins/x/plugin.json' },
        { filename: 'plugins/x/main.wasm' },
      ]),
    );
    const res = await listPullRequestFiles('owner', 'repo', 1);

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toEqual(['plugins/x/plugin.json', 'plugins/x/main.wasm']);
  });
});

describe('searchMyPullRequestNumbers', () => {
  it('検索クエリを組み立ててPR番号一覧を取得する', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, { items: [{ number: 1 }, { number: 2 }] }));
    const res = await searchMyPullRequestNumbers('owner', 'repo', 'alice', 'token');

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toEqual([1, 2]);
    const [url] = lastFetchCall();
    expect(url).toContain(encodeURIComponent('repo:owner/repo type:pr author:alice'));
  });
});

describe('getTree', () => {
  it('blob種別のパスのみを一覧として返す', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, {
        tree: [
          { path: 'plugins', type: 'tree' },
          { path: 'plugins/x/plugin.json', type: 'blob' },
          { path: 'plugins/x/main.wasm', type: 'blob' },
        ],
      }),
    );
    const res = await getTree('owner', 'repo', 'main');

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toEqual(['plugins/x/plugin.json', 'plugins/x/main.wasm']);
    const [url] = lastFetchCall();
    expect(url).toBe('https://api.github.com/repos/owner/repo/git/trees/main?recursive=1');
  });
});

describe('getLastCommitDateForPath', () => {
  it('committerの日時を優先して返す', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, [
        {
          commit: {
            committer: { date: '2026-02-01T00:00:00Z' },
            author: { date: '2026-01-01T00:00:00Z' },
          },
        },
      ]),
    );
    const res = await getLastCommitDateForPath('owner', 'repo', 'plugins/x/plugin.json', 'main');

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('committerが無い場合はauthorの日時にフォールバックする', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, [
        { commit: { committer: null, author: { date: '2026-01-01T00:00:00Z' } } },
      ]),
    );
    const res = await getLastCommitDateForPath('owner', 'repo', 'plugins/x/plugin.json', 'main');

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('コミットが1件も無い場合はNotFoundGithubErrorになる', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, []));
    const res = await getLastCommitDateForPath('owner', 'repo', 'plugins/x/plugin.json', 'main');

    expect(res.ok).toBeFalse();
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(NotFoundGithubError);
  });
});

describe('buildRawFileUrl', () => {
  it('raw.githubusercontent.comのURLを組み立てる', () => {
    const url = buildRawFileUrl(STORE_REPO_OWNER, STORE_REPO_NAME, 'main', 'plugins/x/plugin.json');
    expect(url).toBe(
      `https://raw.githubusercontent.com/${STORE_REPO_OWNER}/${STORE_REPO_NAME}/main/plugins/x/plugin.json`,
    );
  });
});

describe('fetchRawText / fetchRawBinary', () => {
  it('fetchRawTextはテキストを取得する', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, 'hello world', { asText: true }));
    const res = await fetchRawText('https://raw.githubusercontent.com/x/y/main/a.txt');

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toBe('hello world');
  });

  it('fetchRawTextは非okレスポンスをFailureにする', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(404));
    const res = await fetchRawText('https://raw.githubusercontent.com/x/y/main/missing.txt');

    expect(res.ok).toBeFalse();
  });

  it('fetchRawTextはfetchの例外をFailureにする', async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('network down')));
    const res = await fetchRawText('https://raw.githubusercontent.com/x/y/main/a.txt');

    expect(res.ok).toBeFalse();
    if (res.ok) return;
    expect(res.error.message).toBe('network down');
  });

  it('fetchRawBinaryはバイト列を取得する', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    fetchMock.mockResolvedValueOnce(fakeResponse(200, undefined, { arrayBuffer: bytes.buffer }));
    const res = await fetchRawBinary('https://raw.githubusercontent.com/x/y/main/main.wasm');

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(Array.from(res.value)).toEqual([1, 2, 3]);
  });

  it('fetchRawBinaryは非okレスポンスをFailureにする', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(500));
    const res = await fetchRawBinary('https://raw.githubusercontent.com/x/y/main/main.wasm');

    expect(res.ok).toBeFalse();
  });
});
