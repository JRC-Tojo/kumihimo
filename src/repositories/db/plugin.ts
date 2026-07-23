/**
 * プラグインのレジストリ（インストール済み一覧・実行状態）を格納するDexie DB
 *
 * プラグイン申請（PluginSubmission）はストアリポジトリ（GitHub）のPull Requestそのものが
 * 実データであり、ローカルには保存しない（`services/plugin/submissionGithub.ts`が都度
 * GitHub REST APIから取得する）。ただし「マイ申請一覧から取り下げ済み・公開済みの
 * 表示を消したい」という要望に応えるため、非表示にしたPR番号だけをローカルに保持する
 * （GitHub側のPRそのものは削除できない・しないため、あくまで表示上のフィルタ）
 */
import type { Observable } from 'dexie';
import Dexie, { liveQuery, type Table } from 'dexie';
import type { PluginID } from 'src/models/plugin/manifest';
import type { InstalledPlugin, PluginInstallSource } from 'src/models/plugin/installation';
import type { PluginRunState } from 'src/models/plugin/panel';
import type { Result } from 'src/models/error/result';
import { Failure, Success, toError } from 'src/models/error/result';

interface DismissedSubmissionRecord {
  prNumber: number;
  dismissedAt: Date;
}

class PluginDexieDB extends Dexie {
  // すべて out-of-line キー（レコード自体にキーを持たせず、put/get時に明示的に指定する）。
  // installedのキーは`installedKey(id, source)`（`${source}::${id}`）で組み立てる文字列。
  // 同一idでもcatalog/sideloadは別レコードとして共存できるようにするため
  installed!: Table<InstalledPlugin, string>;
  runStates!: Table<PluginRunState, string>;
  dismissedSubmissions!: Table<DismissedSubmissionRecord, number>;

  constructor() {
    super('relational-documents-plugins');
    this.version(1).stores({
      installed: '',
      runStates: ', pluginId',
      dismissedSubmissions: '',
    });
  }
}

/** `installed`テーブルの実キー。同一`id`でもcatalog/sideloadを別レコードとして共存させる */
function installedKey(id: PluginID, source: PluginInstallSource): string {
  return `${source}::${id}`;
}

const db = new PluginDexieDB();

async function ensureReady(): Promise<Result<void>> {
  try {
    await db.open();
    return Success();
  } catch (error) {
    return Failure(toError(error));
  }
}

// ============ インストール済みプラグイン ============

/** インストール済みプラグイン一覧を取得する */
export async function getInstalledPlugins(): Promise<Result<InstalledPlugin[]>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;
  try {
    return Success(await db.installed.toArray());
  } catch (error) {
    return Failure(toError(error));
  }
}

/** 指定ID・インストール経路のインストール済みプラグイン情報を取得する */
export async function getInstalledPlugin(
  id: PluginID,
  source: PluginInstallSource,
): Promise<Result<InstalledPlugin>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;
  try {
    const record = await db.installed.get(installedKey(id, source));
    if (!record) return Failure(new Error(`Not Found Installed Plugin (id: ${id}, source: ${source})`));
    return Success(record);
  } catch (error) {
    return Failure(toError(error));
  }
}

/**
 * インストール済みプラグイン情報を保存する（新規登録・更新の両方）
 *
 * `structuredClone`でディープコピーする（`JSON.parse(JSON.stringify(...))`は
 * `installedAt`等のDateフィールドをISO文字列へ変換してしまい、以降の読み出し時に
 * 型（Date）と実データ（string）が食い違う不具合が起きるため使わない）
 */
export async function putInstalledPlugin(entry: InstalledPlugin): Promise<Result<void>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;
  try {
    await db.installed.put(structuredClone(entry), installedKey(entry.manifest.id, entry.source));
    return Success();
  } catch (error) {
    return Failure(toError(error));
  }
}

/** インストール済みプラグイン情報を削除する */
export async function deleteInstalledPlugin(
  id: PluginID,
  source: PluginInstallSource,
): Promise<Result<void>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;
  try {
    await db.installed.delete(installedKey(id, source));
    return Success();
  } catch (error) {
    return Failure(toError(error));
  }
}

// ============ プラグイン実行状態（一時データ） ============

/** プラグイン実行1回分の状態を取得する */
export async function getRunState(runId: string): Promise<Result<PluginRunState>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;
  try {
    const record = await db.runStates.get(runId);
    if (!record) return Failure(new Error(`Not Found Plugin Run State (runId: ${runId})`));
    return Success(record);
  } catch (error) {
    return Failure(toError(error));
  }
}

/**
 * プラグイン実行1回分の状態を保存する（`putInstalledPlugin`と同じ理由で
 * `structuredClone`を使い、`targetFile`のDateフィールド等を保ったまま保存する）
 */
export async function putRunState(state: PluginRunState): Promise<Result<void>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;
  try {
    await db.runStates.put(structuredClone(state), state.runId);
    return Success();
  } catch (error) {
    return Failure(toError(error));
  }
}

/**
 * DexieのLiveQueryを利用して特定の実行状態を購読する
 */
export function observeRunState(runId: string): Observable<PluginRunState | undefined> {
  return liveQuery(() => db.runStates.get(runId));
}

// ============ マイ申請一覧の非表示設定（ローカルのみ） ============

/** ローカルで非表示にした申請（PR番号）の一覧を取得する */
export async function getDismissedSubmissionPrNumbers(): Promise<Result<number[]>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;
  try {
    const records = await db.dismissedSubmissions.toArray();
    return Success(records.map((r) => r.prNumber));
  } catch (error) {
    return Failure(toError(error));
  }
}

/** 指定PR番号を「マイ申請」一覧から非表示にする */
export async function dismissSubmission(prNumber: number): Promise<Result<void>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;
  try {
    await db.dismissedSubmissions.put({ prNumber, dismissedAt: new Date() }, prNumber);
    return Success();
  } catch (error) {
    return Failure(toError(error));
  }
}
