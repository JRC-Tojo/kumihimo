/**
 * プラグイン申請フローの実装（プラグインストア・リポジトリ https://github.com/JRC-Tojo/RD-PluginStock
 * への実際のフォーク・ブランチ作成・ファイルコミット・Pull Request作成）
 *
 * 認証は設定画面で入力するGitHub個人アクセストークン（PAT）を使う。ブラウザから直接
 * GitHub REST APIを呼び出すため、バックエンドサーバは介在しない
 *
 * CI検証（manifest/wasm/icon/ownership）に合格したPRは、ストアリポジトリ側のGitHub Actions
 * （`validate-plugin-submission.yml`）が自動的にマージする。そのためアプリ側には
 * 「マージする」操作は存在しない（`withdrawSubmission`はマージせずクローズするだけ）
 */
import type { Result } from 'src/models/error/result';
import { Failure, Success, toError } from 'src/models/error/result';
import { PluginManifest } from 'src/models/plugin/manifest';
import type {
  PluginSubmission,
  PluginSubmissionKind,
  PluginSubmissionStatus,
} from 'src/models/plugin/submission';
import { uint8ArrayToBase64, base64ToUint8Array } from 'src/utils/binary/base64';
import { Path } from 'src/utils/binary/path';
import * as gh from 'src/repositories/plugin/githubApi';
import * as pluginDb from 'src/repositories/db/plugin';

const { STORE_REPO_OWNER, STORE_REPO_NAME, STORE_REPO_DEFAULT_BRANCH } = gh;
const PLUGINS_ROOT = new Path('plugins');

function branchNameFor(pluginId: string): string {
  return `plugin/${pluginId}`;
}

/**
 * 取り下げ（unpublish）申請用のブランチ名。`branchNameFor`と同様に**固定名**とすることで、
 * 既に開いている取り下げPRがあれば`findOpenPullRequest`で再利用できるようにする
 * （CI検証に失敗した場合、同じPRへ再度pushして直せるようにするため。以前はランダムな
 * サフィックス付きの名前を毎回生成しており、再申請のたびに新しいPRが増えてしまっていた）
 */
function unpublishBranchNameFor(pluginId: string): string {
  return `unpublish/${pluginId}`;
}

/** ストアリポジトリの`plugins/<id>/`配下にあるファイルの相対パスを組み立てる */
function pluginFilePath(pluginId: string, fileName: string): string {
  return PLUGINS_ROOT.child(pluginId, fileName).path;
}

function pluginJsonPath(pluginId: string): string {
  return pluginFilePath(pluginId, 'plugin.json');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    // atob直後にJSON.parseすると、UTF-8のマルチバイト文字（日本語の説明文等）が
    // 文字化けする（atobはbase64→Latin1文字列への変換のため）。バイト列へ戻してから
    // TextDecoderでUTF-8として解釈する
    const bytesRes = base64ToUint8Array(res.value.content.replace(/\n/g, ''));
    if (!bytesRes.ok) return bytesRes;
    json = JSON.parse(new TextDecoder('utf-8').decode(bytesRes.value));
  } catch (e) {
    return Failure(toError(e));
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
  if (binary) files.push({ path: pluginFilePath(manifest.id, manifest.mainFile), bytes: binary });
  if (icon && manifest.iconFile) {
    files.push({ path: pluginFilePath(manifest.id, manifest.iconFile), bytes: icon });
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
  kind: PluginSubmissionKind,
): Promise<Result<PluginSubmission>> {
  const checksRes = await gh.listCheckRuns(STORE_REPO_OWNER, STORE_REPO_NAME, pr.head.sha, token);
  const checks = checksRes.ok ? checksRes.value : [];

  return Success({
    manifest,
    kind,
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

const SUBMISSION_DETAIL_INITIAL_DELAY_MS = 2000;
const SUBMISSION_DETAIL_RETRY_DELAYS_MS = [1500, 2000, 2500, 3000, 3500, 4000];

/**
 * PR作成直後はGitHub側の反映（PR詳細・Checks APIの索引化）が追いつかず、
 * 取得が404することがある。まず少し待ってから取得し、`NotFoundGithubError`が続く間は
 * 間隔を空けて繰り返し確認する（他のエラーは即座に伝播させる）。
 *
 * 最終的にどうしても取得できなかった場合でも、PRの作成自体は既に成功しているため、
 * 申請全体を失敗として返すのではなく、判明している情報（PR番号・URL・ブランチ）から
 * `status: 'pending'`の暫定的な`PluginSubmission`を組み立てて返す
 */
async function waitAndBuildSubmission(
  manifest: PluginManifest,
  prRef: { number: number; html_url: string },
  token: string,
  kind: PluginSubmissionKind,
  login: string,
  branch: string,
): Promise<Result<PluginSubmission>> {
  await sleep(SUBMISSION_DETAIL_INITIAL_DELAY_MS);

  for (const delay of [0, ...SUBMISSION_DETAIL_RETRY_DELAYS_MS]) {
    if (delay > 0) await sleep(delay);
    const detailRes = await gh.getPullRequest(STORE_REPO_OWNER, STORE_REPO_NAME, prRef.number, token);
    if (detailRes.ok) return buildSubmission(manifest, detailRes.value, token, kind);
    if (!(detailRes.error instanceof gh.NotFoundGithubError)) return detailRes;
  }

  return Success({
    manifest,
    kind,
    status: 'pending',
    prNumber: prRef.number,
    prUrl: prRef.html_url,
    headOwner: login,
    headBranch: branch,
    checks: [],
    submittedAt: new Date(),
    updatedAt: new Date(),
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

  return waitAndBuildSubmission(manifestToSubmit, pr.value, token, 'submit', login, branch);
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

  const dismissedRes = await pluginDb.getDismissedSubmissionPrNumbers();
  const dismissed = new Set(dismissedRes.ok ? dismissedRes.value : []);
  const targetNumbers = numbersRes.value.filter((number) => !dismissed.has(number));

  const submissions: PluginSubmission[] = [];
  for (const number of targetNumbers) {
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

    const kind: PluginSubmissionKind = detailRes.value.head.ref.startsWith('unpublish/')
      ? 'unpublish'
      : 'submit';
    const submissionRes = await buildSubmission(manifestRes.data, detailRes.value, token, kind);
    if (submissionRes.ok) submissions.push(submissionRes.value);
  }

  return Success(submissions);
}

/**
 * 「マイ申請」一覧からPRを非表示にする（GitHub側のPRは変更しない。ローカル表示のみのフィルタ）
 *
 * 取り下げ済み・公開済みなど、これ以上操作の要らない申請を一覧から消したい場合に使う
 */
export function dismissSubmission(prNumber: number): Promise<Result<void>> {
  return pluginDb.dismissSubmission(prNumber);
}

/**
 * 未マージの申請（PR）を取り下げる（マージせずにクローズする）
 *
 * CI検証待ち・検証NGの申請を、マージされる前に自分でキャンセルしたい場合に使う。
 * 公開済みプラグインの取り下げ（deprecatedフラグを立てるPR。`unpublishPlugin`）とは別物
 */
export function withdrawSubmission(prNumber: number, token: string): Promise<Result<void>> {
  return gh.closePullRequest(STORE_REPO_OWNER, STORE_REPO_NAME, prNumber, token);
}

/**
 * 公開済みプラグインの取り下げ（unpublish）を申請する
 *
 * `deprecated: true`を設定するPRを作成する（実ファイルは削除しない）。ownerと一致しない
 * ユーザーからの申請は拒否する。既に開いている取り下げPRがあれば、新規作成せずそこへ
 * 追加のコミットをpushして再利用する（`submitPlugin`と同じ「固定ブランチ名で再利用する」方式）
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

  const branch = unpublishBranchNameFor(pluginId);
  const branchRes = await gh.ensureBranch(login, STORE_REPO_NAME, branch, baseShaRes.value, token);
  if (!branchRes.ok) return branchRes;

  const pushRes = await pushPluginFiles(login, branch, updated, token);
  if (!pushRes.ok) return pushRes;

  let pr = await gh.findOpenPullRequest(STORE_REPO_OWNER, STORE_REPO_NAME, login, branch, token);
  if (!pr.ok) {
    if (!(pr.error instanceof gh.NotFoundGithubError)) return pr;
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
    pr = Success({ number: created.value.number, html_url: created.value.html_url });
  }

  return waitAndBuildSubmission(updated, pr.value, token, 'unpublish', login, branch);
}
