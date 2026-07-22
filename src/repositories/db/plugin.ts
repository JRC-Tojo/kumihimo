/**
 * プラグインのレジストリ（インストール済み一覧・実行状態）を格納するDexie DB
 *
 * プラグイン申請（PluginSubmission）はストアリポジトリ（GitHub）のPull Requestそのものが
 * 実データであり、ローカルには保存しない（`services/plugin/submissionGithub.ts`が都度
 * GitHub REST APIから取得する）
 */
import type { Observable } from 'dexie';
import Dexie, { liveQuery, type Table } from 'dexie';
import type { PluginID } from 'src/models/plugin/manifest';
import type { InstalledPlugin } from 'src/models/plugin/installation';
import type { PluginRunState } from 'src/models/plugin/panel';
import type { Result } from 'src/models/error/result';
import { Failure, Success, toError } from 'src/models/error/result';

class PluginDexieDB extends Dexie {
  // すべて out-of-line キー（レコード自体にキーを持たせず、put/get時に明示的に指定する）
  installed!: Table<InstalledPlugin, PluginID>;
  runStates!: Table<PluginRunState, string>;

  constructor() {
    super('relational-documents-plugins');
    this.version(1).stores({
      installed: '',
      runStates: ', pluginId',
    });
  }
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

export async function getInstalledPlugins(): Promise<Result<InstalledPlugin[]>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;
  try {
    return Success(await db.installed.toArray());
  } catch (error) {
    return Failure(toError(error));
  }
}

export async function getInstalledPlugin(id: PluginID): Promise<Result<InstalledPlugin>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;
  try {
    const record = await db.installed.get(id);
    if (!record) return Failure(new Error(`Not Found Installed Plugin (id: ${id})`));
    return Success(record);
  } catch (error) {
    return Failure(toError(error));
  }
}

export async function putInstalledPlugin(entry: InstalledPlugin): Promise<Result<void>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;
  try {
    const raw = JSON.parse(JSON.stringify(entry)) as InstalledPlugin;
    await db.installed.put(raw, entry.manifest.id);
    return Success();
  } catch (error) {
    return Failure(toError(error));
  }
}

export async function deleteInstalledPlugin(id: PluginID): Promise<Result<void>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;
  try {
    await db.installed.delete(id);
    return Success();
  } catch (error) {
    return Failure(toError(error));
  }
}

// ============ プラグイン実行状態（一時データ） ============

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

export async function putRunState(state: PluginRunState): Promise<Result<void>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;
  try {
    const raw = JSON.parse(JSON.stringify(state)) as PluginRunState;
    await db.runStates.put(raw, state.runId);
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
