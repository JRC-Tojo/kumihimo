/**
 * プラグインストア・リポジトリ（GitHub）に対するREST API呼び出しをまとめたリポジトリ層
 *
 * 本アプリはバックエンドを持たないブラウザ完結型のため、フォーク作成・ブランチ作成・
 * ファイルコミット・PR作成・Checks確認はすべてブラウザから直接GitHub REST APIを呼んで行う。
 * 認証はユーザーが設定画面で入力する個人アクセストークン（PAT）を使う
 */
import type { Result } from 'src/models/error/result';
import { Failure, Success, toError } from 'src/models/error/result';

export const STORE_REPO_OWNER = 'JRC-Tojo';
export const STORE_REPO_NAME = 'RD-PluginStock';
export const STORE_REPO_DEFAULT_BRANCH = 'main';

const GITHUB_API_BASE = 'https://api.github.com';

function buildHeaders(token: string | undefined, extra?: Record<string, string>) {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...extra,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * GitHub REST APIを呼び出す（レスポンスをJSONとして解釈する）
 */
async function githubRequest<T>(
  path: string,
  token: string | undefined,
  init?: RequestInit,
): Promise<Result<T>> {
  try {
    const res = await fetch(`${GITHUB_API_BASE}${path}`, {
      ...init,
      headers: buildHeaders(token, init?.headers as Record<string, string> | undefined),
    });
    if (res.status === 404) return Failure(new NotFoundGithubError(path));
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return Failure(new Error(`GitHub API error (${res.status} ${path}): ${body}`));
    }
    if (res.status === 204) return Success(undefined as T);
    const data = (await res.json()) as T;
    return Success(data);
  } catch (e) {
    return Failure(toError(e));
  }
}

/** GitHub APIが404を返した場合の専用エラー（"存在しない"を通常エラーと区別するため） */
export class NotFoundGithubError extends Error {
  constructor(path: string) {
    super(`Not Found: ${path}`);
    this.name = 'NotFoundGithubError';
  }
}

export interface GithubUser {
  login: string;
}

export function getAuthenticatedUser(token: string): Promise<Result<GithubUser>> {
  return githubRequest<GithubUser>('/user', token);
}

interface GithubRepo {
  default_branch: string;
}

export function getRepo(owner: string, repo: string, token?: string): Promise<Result<GithubRepo>> {
  return githubRequest<GithubRepo>(`/repos/${owner}/${repo}`, token);
}

/**
 * `login`配下にストアリポジトリのフォークが存在することを保証する（なければ作成し、準備完了まで待つ）
 */
export async function ensureFork(token: string, login: string): Promise<Result<void>> {
  const existing = await getRepo(login, STORE_REPO_NAME, token);
  if (existing.ok) return Success(undefined);
  if (!(existing.error instanceof NotFoundGithubError)) return existing;

  const forkRes = await githubRequest(
    `/repos/${STORE_REPO_OWNER}/${STORE_REPO_NAME}/forks`,
    token,
    { method: 'POST' },
  );
  if (!forkRes.ok) return forkRes;

  // フォーク作成は非同期のため、参照可能になるまで少し待ちながら確認する
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const check = await getRepo(login, STORE_REPO_NAME, token);
    if (check.ok) return Success(undefined);
  }
  return Failure(
    new Error('フォークの作成完了を確認できませんでした（時間をおいて再度お試しください）'),
  );
}

interface GithubRef {
  object: { sha: string };
}

export async function getBranchSha(
  owner: string,
  repo: string,
  branch: string,
  token?: string,
): Promise<Result<string>> {
  const res = await githubRequest<GithubRef>(
    `/repos/${owner}/${repo}/git/ref/heads/${branch}`,
    token,
  );
  if (!res.ok) return res;
  return Success(res.value.object.sha);
}

/**
 * ブランチを作成する（既に存在する場合はそれを成功として扱う＝再申請時の再利用を許す）
 */
export async function ensureBranch(
  owner: string,
  repo: string,
  branch: string,
  fromSha: string,
  token: string,
): Promise<Result<void>> {
  const existing = await getBranchSha(owner, repo, branch, token);
  if (existing.ok) return Success(undefined);
  if (!(existing.error instanceof NotFoundGithubError)) return existing;

  const res = await githubRequest(`/repos/${owner}/${repo}/git/refs`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: fromSha }),
  });
  if (!res.ok) return res;
  return Success(undefined);
}

interface GithubContent {
  sha: string;
  content: string; // base64（改行含む）
}

/**
 * 指定パスのファイル内容を取得する（存在しない場合はNotFoundGithubError）
 */
export function getFileContent(
  owner: string,
  repo: string,
  path: string,
  ref: string,
  token?: string,
): Promise<Result<GithubContent>> {
  return githubRequest<GithubContent>(
    `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
    token,
  );
}

/**
 * ファイルを作成・更新する（既存ファイルのshaを渡した場合は更新、省略時は新規作成）
 */
export async function putFile(
  owner: string,
  repo: string,
  path: string,
  branch: string,
  base64Content: string,
  message: string,
  token: string,
  sha?: string,
): Promise<Result<void>> {
  const res = await githubRequest(`/repos/${owner}/${repo}/contents/${path}`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: base64Content, branch, sha }),
  });
  if (!res.ok) return res;
  return Success(undefined);
}

interface GithubPullRequestSummary {
  number: number;
  html_url: string;
}

/**
 * 指定headブランチに対する既存のオープンPRを探す（なければNotFoundGithubError）
 */
export async function findOpenPullRequest(
  owner: string,
  repo: string,
  headOwner: string,
  branch: string,
  token?: string,
): Promise<Result<GithubPullRequestSummary>> {
  const res = await githubRequest<GithubPullRequestSummary[]>(
    `/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(`${headOwner}:${branch}`)}`,
    token,
  );
  if (!res.ok) return res;
  const found = res.value[0];
  if (!found) return Failure(new NotFoundGithubError(`pulls?head=${headOwner}:${branch}`));
  return Success(found);
}

export async function createPullRequest(
  owner: string,
  repo: string,
  params: { title: string; body: string; head: string; base: string },
  token: string,
): Promise<Result<GithubPullRequestSummary>> {
  return githubRequest<GithubPullRequestSummary>(`/repos/${owner}/${repo}/pulls`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export interface GithubPullRequestDetail {
  number: number;
  html_url: string;
  state: 'open' | 'closed';
  merged: boolean;
  head: { sha: string; ref: string; user: { login: string } };
  user: { login: string };
  created_at: string;
  updated_at: string;
}

export function getPullRequest(
  owner: string,
  repo: string,
  number: number,
  token?: string,
): Promise<Result<GithubPullRequestDetail>> {
  return githubRequest<GithubPullRequestDetail>(`/repos/${owner}/${repo}/pulls/${number}`, token);
}

export async function mergePullRequest(
  owner: string,
  repo: string,
  number: number,
  token: string,
): Promise<Result<void>> {
  const res = await githubRequest(`/repos/${owner}/${repo}/pulls/${number}/merge`, token, {
    method: 'PUT',
  });
  if (!res.ok) return res;
  return Success(undefined);
}

/**
 * PRをマージせずにクローズする（申請の取り下げに使う）
 */
export async function closePullRequest(
  owner: string,
  repo: string,
  number: number,
  token: string,
): Promise<Result<void>> {
  const res = await githubRequest(`/repos/${owner}/${repo}/pulls/${number}`, token, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'closed' }),
  });
  if (!res.ok) return res;
  return Success(undefined);
}

export interface GithubCheckRun {
  name: string;
  status: string;
  conclusion: string | null;
}

export async function listCheckRuns(
  owner: string,
  repo: string,
  ref: string,
  token?: string,
): Promise<Result<GithubCheckRun[]>> {
  const res = await githubRequest<{ check_runs: GithubCheckRun[] }>(
    `/repos/${owner}/${repo}/commits/${ref}/check-runs`,
    token,
  );
  if (!res.ok) return res;
  return Success(res.value.check_runs);
}

interface GithubPullRequestFile {
  filename: string;
}

/**
 * PRで変更されたファイルパス一覧を取得する（申請対象のプラグインIDを特定するために使う）
 */
export async function listPullRequestFiles(
  owner: string,
  repo: string,
  number: number,
  token?: string,
): Promise<Result<string[]>> {
  const res = await githubRequest<GithubPullRequestFile[]>(
    `/repos/${owner}/${repo}/pulls/${number}/files`,
    token,
  );
  if (!res.ok) return res;
  return Success(res.value.map((f) => f.filename));
}

interface GithubSearchIssuesResult {
  items: { number: number }[];
}

/**
 * 指定ユーザーが作成した、このリポジトリ宛のPR番号一覧を検索する
 */
export async function searchMyPullRequestNumbers(
  owner: string,
  repo: string,
  login: string,
  token: string,
): Promise<Result<number[]>> {
  const q = encodeURIComponent(`repo:${owner}/${repo} type:pr author:${login}`);
  const res = await githubRequest<GithubSearchIssuesResult>(`/search/issues?q=${q}`, token);
  if (!res.ok) return res;
  return Success(res.value.items.map((item) => item.number));
}

interface GithubTree {
  tree: { path: string; type: string }[];
}

/**
 * リポジトリのファイルツリーを取得する（`plugins/<id>/plugin.json`の列挙に使う）
 */
export async function getTree(
  owner: string,
  repo: string,
  branch: string,
  token?: string,
): Promise<Result<string[]>> {
  const res = await githubRequest<GithubTree>(
    `/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    token,
  );
  if (!res.ok) return res;
  return Success(res.value.tree.filter((t) => t.type === 'blob').map((t) => t.path));
}

/**
 * 公開リポジトリの生ファイルURL（raw.githubusercontent.com）を組み立てる
 *
 * 表示・読み取り専用の用途ではAPIのレート制限を消費しないこちらを優先して使う
 */
export function buildRawFileUrl(owner: string, repo: string, ref: string, path: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
}

export async function fetchRawText(url: string): Promise<Result<string>> {
  try {
    const res = await fetch(url);
    if (!res.ok) return Failure(new Error(`Failed to fetch ${url} (${res.status})`));
    return Success(await res.text());
  } catch (e) {
    return Failure(toError(e));
  }
}

export async function fetchRawBinary(url: string): Promise<Result<Uint8Array>> {
  try {
    const res = await fetch(url);
    if (!res.ok) return Failure(new Error(`Failed to fetch ${url} (${res.status})`));
    return Success(new Uint8Array(await res.arrayBuffer()));
  } catch (e) {
    return Failure(toError(e));
  }
}
