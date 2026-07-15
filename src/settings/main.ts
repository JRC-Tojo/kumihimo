/**
 * ユーザー固有の設定を保存しておく
 */

import type { ContainerID, ContainerSkel, RecentContainerEntry } from 'src/models/container';
import type { AnnotationTool } from 'src/models/docPage';
import { Success, type Result } from 'src/models/error/result';
import { AppSettings } from 'src/models/settings';
import * as db from 'src/repositories/inMemory/IndexedDB';

const SETTINGS_STORE_NAME = 'settings';

/**
 * 設定の初期化
 */
export async function initializeSettings(): Promise<Result<AppSettings>> {
  const def = AppSettings.parse({ initialized: true });
  def.tools.annotations = defaultAnnotationTools;

  const res = await Promise.all(
    Object.entries(def).map(([k, v]) => db.setValue(SETTINGS_STORE_NAME, k, v)),
  );
  const errRes = res.find((r) => !r.ok);

  if (errRes === void 0) {
    return Success(def);
  } else {
    return errRes;
  }
}

/**
 * ユーザー設定を取得する
 */
export function getSettings(): Promise<Result<AppSettings>> {
  return db.getValue(SETTINGS_STORE_NAME, AppSettings);
}

/**
 * ユーザー設定を保存する
 */
export function saveSettings<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
): Promise<Result<void>> {
  return db.setValue(SETTINGS_STORE_NAME, key, value);
}

/**
 * 設定の読み込み→変更→保存（read-modify-write）を直列化して実行するキュー
 *
 * `addLoadedContainer`/`addRecentContainer`はそれぞれ`getSettings()`で読んだ内容に基づいて
 * 保存するため、同時に呼ばれると後勝ちで片方の追加が失われる（`saveSettings`自体はkeyごとの
 * 単純な書き込みのため、read-modify-write自体を直列化する必要がある）
 */
let settingsUpdateQueue: Promise<unknown> = Promise.resolve();

/**
 * 最新の設定を読み込んだうえで`update`を実行する処理を、直前の更新完了後に実行されるよう
 * キューイングする
 */
function withSerializedSettingsUpdate<T>(
  update: (current: AppSettings) => Promise<Result<T>>,
): Promise<Result<T>> {
  const run = async (): Promise<Result<T>> => {
    const settingsRes = await getSettings();
    if (!settingsRes.ok) return settingsRes;
    return update(settingsRes.value);
  };

  const result = settingsUpdateQueue.then(run, run);
  settingsUpdateQueue = result;
  return result;
}

/**
 * 読み込み対象のコンテナを追加する
 *
 * 既に同一IDが読み込み対象に含まれている場合は、その情報を最新化する（重複追加はしない）
 */
export async function addLoadedContainer(c: ContainerSkel): Promise<Result<void>> {
  return withSerializedSettingsUpdate((settings) => {
    const newContainers = [
      ...settings.containerSkels.filter((existing) => existing.id !== c.id),
      c,
    ];
    return saveSettings('containerSkels', newContainers);
  });
}

/**
 * 読み込み対象のコンテナを削除する
 */
export async function removeLoadedContainer(cId: ContainerID): Promise<Result<void>> {
  const settingsRes = await getSettings();
  if (!settingsRes.ok) return settingsRes;

  const settings = settingsRes.value;
  const newContainers = settings.containerSkels.filter((c) => c.id !== cId);
  return saveSettings('containerSkels', newContainers);
}

/** 「最近読み込んだコンテナ一覧」に保持する最大件数 */
const MAX_RECENT_CONTAINERS = 20;

/**
 * 「最近読み込んだコンテナ一覧」にコンテナを追加（既存の場合は最新化）する
 *
 * コンテナをアンロードしてもこの一覧からは消さない（再読込の選択肢として使うため）
 */
export async function addRecentContainer(c: ContainerSkel): Promise<Result<void>> {
  return withSerializedSettingsUpdate((settings) => {
    const entry: RecentContainerEntry = { ...c, lastOpenedAt: new Date() };
    const withoutSame = settings.recentContainers.filter((r) => r.id !== c.id);
    const newRecents = [entry, ...withoutSame]
      .sort((a, b) => b.lastOpenedAt.getTime() - a.lastOpenedAt.getTime())
      .slice(0, MAX_RECENT_CONTAINERS);

    return saveSettings('recentContainers', newRecents);
  });
}

/**
 * 「最近読み込んだコンテナ一覧」を取得する（最新順）
 */
export async function getRecentContainers(): Promise<Result<RecentContainerEntry[]>> {
  const settingsRes = await getSettings();
  if (!settingsRes.ok) return settingsRes;

  return Success(
    [...settingsRes.value.recentContainers].sort(
      (a, b) => b.lastOpenedAt.getTime() - a.lastOpenedAt.getTime(),
    ),
  );
}

const defaultAnnotationTools: AnnotationTool[] = [
  {
    id: 'line-preset-1',
    name: '実線（黒）',
    style: {
      type: 'line',
      strokeColor: '#000000',
      strokeType: 'solid',
      strokeWidth: 5,
      strokeOpacity: 1,
    },
  },
  {
    id: 'line-preset-2',
    name: '点線（赤）',
    style: {
      type: 'line',
      strokeColor: '#FF0000',
      strokeType: 'dash-dot',
      strokeWidth: 10,
      strokeOpacity: 1,
    },
  },
  {
    id: 'box-preset-1',
    name: 'ボックス（青枠）',
    style: {
      type: 'box',
      strokeColor: '#0000FF',
      strokeWidth: 5,
      strokeType: 'solid',
      strokeOpacity: 1,
      fillColor: '#0000FF',
      fillPattern: 'solid',
      fillOpacity: 0.5,
    },
  },
  {
    id: 'circle-preset-1',
    name: '円（緑枠）',
    style: {
      type: 'circle',
      strokeColor: '#009900',
      strokeWidth: 3,
      strokeType: 'solid',
      strokeOpacity: 1,
      fillColor: '#009900',
      fillPattern: 'solid',
      fillOpacity: 0.3,
    },
  },
];
