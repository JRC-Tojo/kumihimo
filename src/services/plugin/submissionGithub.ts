/**
 * プラグイン申請フローの実装（プラグインストア・リポジトリ https://github.com/JRC-Tojo/RD-PluginStock
 * への実際のフォーク・ブランチ作成・ファイルコミット・Pull Request作成）
 *
 * 認証は設定画面で入力するGitHub個人アクセストークン（PAT）を使う。ブラウザから直接
 * GitHub REST APIを呼び出すため、バックエンドサーバは介在しない
 */
import { v4 as uuidv4 } from 'uuid';
import type { Result } from 'src/models/error/result';
import { Failure, Success } from 'src/models/error/result';
import { PluginManifest } from 'src/models/plugin/manifest';
import type { PluginSubmission, PluginSubmissionStatus } from 'src/models/plugin/submission';
import { uint8ArrayToBase64 } from 'src/utils/binary/base64';
import * as gh from 'src/repositories/plugin/githubApi';

const { STORE_REPO_OWNER, STORE_REPO_NAME, STORE_REPO_DEFAULT_BRANCH } = gh;

function branchNameFor(pluginId: string): string {
  return `plugin/${pluginId}`;
}

function pluginJsonPath(pluginId: string): string {
  return `plugins/${pluginId}/plugin.json`;
}

/**
 * ストアリポジトリのdefaultブランチに現在公開されているマニフェストを取得する
 * （初回申請かどうか、および申請者がownerと一致するかの検証に使う）
 */
async function fetchPublishedManifest(
  pluginId: string,
  token: string,
): Promise<Result<PluginManifest | undefined>> {
  const res = await gh.getFileContent(
    STORE_REPO_OWNER,
    STORE_REPO_NAME,
    pluginJsonPath(pluginId),
    STORE_REPO_DEFAULT_BRANCH,
    token,
  );
  if (!res.ok) {
    if (res.error instanceof gh.NotFoundGithubError) return Success(undefined);
    return res;
  }
  let json: unknown;
  try {
    json = JSON.parse(atob(res.value.content.replace(/\n/g, '')));
  } catch (e) {
    return Failure(e instanceof Error ? e : new Error(String(e)));
  }
  const parsed = PluginManifest.safeParse(json);
  if (!parsed.success) return Failure(parsed.error);
  return Success(parsed.data);
}

/**
 * `plugin.json`（および指定されていればmainFile/iconFile）を、提出者のフォーク上の
 * 申請用ブランチへコミットする（新規作成・更新のいずれも同じ経路で扱う）
 */
async function pushPluginFiles(
  login: string,
  branch: string,
  manifest: PluginManifest,
  token: string,
  binary?: Uint8Array,
  icon?: Uint8Array,
): Promise<Result<void>> {
  const files: { path: string; bytes: Uint8Array }[] = [
    {
      path: pluginJsonPath(manifest.id),
      bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
    },
  ];
  if (binary) files.push({ path: `plugins/${manifest.id}/${manifest.mainFile}`, bytes: binary });
  if (icon && manifest.iconFile) {
    files.push({ path: `plugins/${manifest.id}/${manifest.iconFile}`, bytes: icon });
  }

  for (const file of files) {
    const b64Res = uint8ArrayToBase64(file.bytes);
    if (!b64Res.ok) return b64Res;

    const existing = await gh.getFileContent(login, STORE_REPO_NAME, file.path, branch, token);
    const sha = existing.ok ? existing.value.sha : undefined;
    if (!existing.ok && !(existing.error instanceof gh.NotFoundGithubError)) return existing;

    const putRes = await gh.putFile(
      login,
      STORE_REPO_NAME,
      file.path,
      branch,
      b64Res.value,
      `${sha ? 'Update' : 'Add'} ${file.path}`,
      token,
      sha,
    );
    if (!putRes.ok) return putRes;
  }

  return Success(undefined);
}

function deriveStatus(
  pr: gh.GithubPullRequestDetail,
  checks: gh.GithubCheckRun[],
): PluginSubmissionStatus {
  if (pr.merged) return 'published';
  if (pr.state === 'closed') return 'withdrawn';
  if (checks.length === 0) return 'pending';
  if (checks.some((c) => c.conclusion === 'failure' || c.conclusion === 'timed_out')) {
    return 'ci_failed';
  }
  if (checks.every((c) => c.conclusion !== null)) return 'ci_passed';
  return 'pending';
}

async function buildSubmission(
  manifest: PluginManifest,
  pr: gh.GithubPullRequestDetail,
  token: string,
): Promise<Result<PluginSubmission>> {
  const checksRes = await gh.listCheckRuns(STORE_REPO_OWNER, STORE_REPO_NAME, pr.head.sha, token);
  const checks = checksRes.ok ? checksRes.value : [];

  return Success({
    manifest,
    status: deriveStatus(pr, checks),
    prNumber: pr.number,
    prUrl: pr.html_url,
    headOwner: pr.head.user.login,
    headBranch: pr.head.ref,
    checks: checks.map((c) => ({ name: c.name, conclusion: c.conclusion })),
    submittedAt: new Date(pr.created_at),
    updatedAt: new Date(pr.updated_at),
  });
}

/**
 * プラグインを申請する（新規申請・バージョン更新のいずれも同じ経路で扱う）
 *
 * - 新規プラグイン: マニフェストのownerを申請者のGitHubユーザー名に設定する
 * - 既存プラグインの更新: default branchに公開済みのownerと申請者が一致しない場合は拒否する
 *   （最終的な、なりすまし防止の実効的な検証はストアリポジトリのCI側で行われる。
 *   ここでのチェックはユーザーへの早期フィードバックのため）
 */
export async function submitPlugin(
  manifest: PluginManifest,
  binary: Uint8Array,
  icon: Uint8Array | undefined,
  token: string,
): Promise<Result<PluginSubmission>> {
  const userRes = await gh.getAuthenticatedUser(token);
  if (!userRes.ok) return userRes;
  const login = userRes.value.login;

  const publishedRes = await fetchPublishedManifest(manifest.id, token);
  if (!publishedRes.ok) return publishedRes;
  const published = publishedRes.value;
  if (published && published.owner !== login) {
    return Failure(
      new Error(
        `このプラグインは既に別のユーザー（${published.owner ?? '不明'}）によって公開されています。バージョン更新はそのユーザーのみ行えます。`,
      ),
    );
  }

  const manifestToSubmit: PluginManifest = { ...manifest, owner: login };

  const forkRes = await gh.ensureFork(token, login);
  if (!forkRes.ok) return forkRes;

  const baseShaRes = await gh.getBranchSha(
    STORE_REPO_OWNER,
    STORE_REPO_NAME,
    STORE_REPO_DEFAULT_BRANCH,
    token,
  );
  if (!baseShaRes.ok) return baseShaRes;

  const branch = branchNameFor(manifest.id);
  const branchRes = await gh.ensureBranch(login, STORE_REPO_NAME, branch, baseShaRes.value, token);
  if (!branchRes.ok) return branchRes;

  const pushRes = await pushPluginFiles(login, branch, manifestToSubmit, token, binary, icon);
  if (!pushRes.ok) return pushRes;

  let pr = await gh.findOpenPullRequest(STORE_REPO_OWNER, STORE_REPO_NAME, login, branch, token);
  if (!pr.ok) {
    if (!(pr.error instanceof gh.NotFoundGithubError)) return pr;
    const created = await gh.createPullRequest(
      STORE_REPO_OWNER,
      STORE_REPO_NAME,
      {
        title: `[Plugin] ${manifestToSubmit.name} (${manifestToSubmit.id}) v${manifestToSubmit.version}`,
        body: `プラグイン「${manifestToSubmit.name}」（\`${manifestToSubmit.id}\`）v${manifestToSubmit.version} の${published ? '更新' : '新規'}申請です。\n\n_RelationalDocumentsアプリから自動送信されました。_`,
        head: `${login}:${branch}`,
        base: STORE_REPO_DEFAULT_BRANCH,
      },
      token,
    );
    if (!created.ok) return created;
    pr = Success({ number: created.value.number, html_url: created.value.html_url });
  }

  const detailRes = await gh.getPullRequest(
    STORE_REPO_OWNER,
    STORE_REPO_NAME,
    pr.value.number,
    token,
  );
  if (!detailRes.ok) return detailRes;

  return buildSubmission(manifestToSubmit, detailRes.value, token);
}

/**
 * 自分が行った申請（PR）一覧を取得する
 */
export async function getSubmissions(token: string): Promise<Result<PluginSubmission[]>> {
  const userRes = await gh.getAuthenticatedUser(token);
  if (!userRes.ok) return userRes;
  const login = userRes.value.login;

  const numbersRes = await gh.searchMyPullRequestNumbers(
    STORE_REPO_OWNER,
    STORE_REPO_NAME,
    login,
    token,
  );
  if (!numbersRes.ok) return numbersRes;

  const submissions: PluginSubmission[] = [];
  for (const number of numbersRes.value) {
    const detailRes = await gh.getPullRequest(STORE_REPO_OWNER, STORE_REPO_NAME, number, token);
    if (!detailRes.ok) continue;

    const filesRes = await gh.listPullRequestFiles(
      STORE_REPO_OWNER,
      STORE_REPO_NAME,
      number,
      token,
    );
    if (!filesRes.ok) continue;
    const manifestPath = filesRes.value.find((f) => /^plugins\/[^/]+\/plugin\.json$/.test(f));
    if (!manifestPath) continue;

    const rawUrl = gh.buildRawFileUrl(
      detailRes.value.head.user.login,
      STORE_REPO_NAME,
      detailRes.value.head.sha,
      manifestPath,
    );
    const textRes = await gh.fetchRawText(rawUrl);
    if (!textRes.ok) continue;
    let json: unknown;
    try {
      json = JSON.parse(textRes.value);
    } catch {
      continue;
    }
    const manifestRes = PluginManifest.safeParse(json);
    if (!manifestRes.success) continue;

    const submissionRes = await buildSubmission(manifestRes.data, detailRes.value, token);
    if (submissionRes.ok) submissions.push(submissionRes.value);
  }

  return Success(submissions);
}

/**
 * CI合格済みのPRをマージする（マージ権限がない場合は失敗するため、その旨をエラーで案内する）
 */
export async function republishSubmission(prNumber: number, token: string): Promise<Result<void>> {
  const res = await gh.mergePullRequest(STORE_REPO_OWNER, STORE_REPO_NAME, prNumber, token);
  if (!res.ok) {
    return Failure(
      new Error(
        `マージに失敗しました（マージ権限がない場合は、PRページからリポジトリのメンテナに依頼してください）: ${res.error.message}`,
      ),
    );
  }
  return res;
}

/**
 * 未マージの申請（PR）を取り下げる（マージせずにクローズする）
 *
 * CI検証待ち・検証NGの申請を、マージされる前に自分でキャンセルしたい場合に使う。
 * 公開済みプラグインの取り下げ（deprecatedフラグを立てるPR）とは別物
 */
export async function withdrawSubmission(prNumber: number, token: string): Promise<Result<void>> {
  return gh.closePullRequest(STORE_REPO_OWNER, STORE_REPO_NAME, prNumber, token);
}

/**
 * 公開済みプラグインの取り下げ（unpublish）を申請する
 *
 * `deprecated: true`を設定するPRを作成する（実ファイルは削除しない）。ownerと一致しない
 * ユーザーからの申請は拒否する
 */
export async function unpublishPlugin(
  pluginId: string,
  token: string,
): Promise<Result<PluginSubmission>> {
  const userRes = await gh.getAuthenticatedUser(token);
  if (!userRes.ok) return userRes;
  const login = userRes.value.login;

  const publishedRes = await fetchPublishedManifest(pluginId, token);
  if (!publishedRes.ok) return publishedRes;
  const published = publishedRes.value;
  if (!published) return Failure(new Error('公開済みのプラグインが見つかりません'));
  if (published.owner !== login) {
    return Failure(new Error('このプラグインの取り下げは、公開したユーザーのみ行えます'));
  }

  const updated: PluginManifest = { ...published, deprecated: true };

  const forkRes = await gh.ensureFork(token, login);
  if (!forkRes.ok) return forkRes;

  const baseShaRes = await gh.getBranchSha(
    STORE_REPO_OWNER,
    STORE_REPO_NAME,
    STORE_REPO_DEFAULT_BRANCH,
    token,
  );
  if (!baseShaRes.ok) return baseShaRes;

  const branch = `unpublish/${pluginId}-${uuidv4().slice(0, 8)}`;
  const branchRes = await gh.ensureBranch(login, STORE_REPO_NAME, branch, baseShaRes.value, token);
  if (!branchRes.ok) return branchRes;

  const pushRes = await pushPluginFiles(login, branch, updated, token);
  if (!pushRes.ok) return pushRes;

  const created = await gh.createPullRequest(
    STORE_REPO_OWNER,
    STORE_REPO_NAME,
    {
      title: `[Unpublish] ${updated.name} (${updated.id})`,
      body: `プラグイン「${updated.name}」（\`${updated.id}\`）の取り下げ（unpublish）申請です。\n\n_RelationalDocumentsアプリから自動送信されました。_`,
      head: `${login}:${branch}`,
      base: STORE_REPO_DEFAULT_BRANCH,
    },
    token,
  );
  if (!created.ok) return created;

  const detailRes = await gh.getPullRequest(
    STORE_REPO_OWNER,
    STORE_REPO_NAME,
    created.value.number,
    token,
  );
  if (!detailRes.ok) return detailRes;

  return buildSubmission(updated, detailRes.value, token);
}
