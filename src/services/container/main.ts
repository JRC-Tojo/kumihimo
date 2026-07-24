/**
 * コンテナに関する操作を提供する
 */

import type {
  ContainerElement,
  ContainerElementFile,
  ContainerElementFolder,
  ContainerSkel,
  ContainerType,
  RenamedEntry,
} from 'src/models/container';
import { Container } from 'src/models/container';
import { ContainerID } from 'src/models/container';
import { Failure, Success, type Result } from 'src/models/error/result';
import * as cache from 'src/repositories/container/cache';
import * as box from 'src/repositories/container/box';
import * as local from 'src/repositories/container/local';
import * as settings from 'src/settings/main';
import { fromEntries } from 'src/utils/obj/obj';
import { DocumentSource } from 'src/models/document/common';
import { v4 as uuidv4 } from 'uuid';
import { getBase64FileSize } from 'src/utils/binary/base64';
import { Path } from 'src/utils/binary/path';

export type { RenamedEntry };

/**
 * 処理をコンテナ種別ごとに振り分ける
 */
async function switchContainerProcess<T>(
  cType: ContainerType,
  boxProcess: () => Promise<T>,
  localProcess: () => Promise<T>,
  cacheProcess: () => Promise<T>,
): Promise<T> {
  switch (cType) {
    case 'box':
      return await boxProcess();
    case 'cache':
      return await cacheProcess();
    case 'local':
      return await localProcess();
  }
}

let cachedContainers: { [id: ContainerID]: Container | ContainerSkel } = {};

/**
 * コンテナIDからコンテナ情報を取得する
 */
export function getContainer(id: ContainerID): Result<Container | ContainerSkel> {
  const c = cachedContainers[id];
  if (c === void 0) {
    return Failure(new Error(`Not Found Container (id: ${id})`));
  }
  return Success(c);
}

/**
 * コンテナの内部が読み込み済みであるか否かを返す
 */
function parseContainer(c: Container | ContainerSkel) {
  return Container.safeParse(c);
}

/**
 * コンテナ一覧を取得する
 *
 * コンテナ要素であるファイル情報などは未取得の状態で返す。
 * 各種リポジトリは一度登録されたコンテナの情報を（閉じた後も）保持し続けるため、
 * ここでは設定の「読み込み対象のコンテナ」一覧（`settings.containerSkels`）に
 * 含まれるものだけへ絞り込むことで、閉じたコンテナが一覧に残り続けないようにする
 */
export async function getAllContainers(): Promise<Result<ContainerSkel[]>> {
  const settingsRes = await settings.getSettings();
  if (!settingsRes.ok) return settingsRes;
  const loadedIds = new Set(settingsRes.value.containerSkels.map((c) => c.id));

  const gotContainers = await Promise.all([
    cache.getContainers(),
    box.getContainers(),
    local.getContainers(),
  ]);
  const flatContainers = gotContainers.flat();
  const errContainerProvider = flatContainers.find((cs) => !cs.ok);
  if (errContainerProvider !== void 0) return errContainerProvider;

  cachedContainers = fromEntries(
    flatContainers
      .filter((cs) => cs.ok)
      .map((cs) => {
        return cs.value.map((c) => [c.id, c] as [ContainerID, Container]);
      })
      .flat()
      .filter(([id]) => loadedIds.has(id)),
  );

  return Success(Object.values(cachedContainers));
}

/**
 * コンテナ情報を読み込む
 *
 * コンテナ要素まですべて読み込む
 */
export async function loadContainer(
  id: ContainerID,
  forceReload: boolean = false,
): Promise<Result<Container>> {
  const c = getContainer(id);
  if (!c.ok) return c;

  // キャッシュがすでに入っている場合はそのデータを返す（forceReload時は実データを読み直す）
  if (!forceReload) {
    const cached = parseContainer(c.value);
    if (cached.success) return Success(cached.data);
  }

  // コンテナ要素情報の読み取り
  const loadedContainer = await switchContainerProcess(
    c.value.type,
    () => box.loadContainerElements(c.value),
    () => local.loadContainerElements(c.value),
    () => cache.loadContainerElements(c.value),
  );
  if (!loadedContainer.ok) return loadedContainer;

  // キャッシュの更新
  cachedContainers[c.value.id] = loadedContainer.value;

  // 最近読み込んだコンテナ一覧を最新化する（ベストエフォート）
  await settings.addRecentContainer(loadedContainer.value);

  return loadedContainer;
}

/**
 * コンテナ要素の最新状態を、共有キャッシュ（`cachedContainers`）を更新せずに読み取る
 *
 * 外部での変更検知（ポーリング等）のためだけに実データを覗きたい場合に使う。
 * `loadContainer(id, true)`と異なりキャッシュへのコミットを行わないため、
 * 呼び出し側が変更内容を確認してから明示的に`loadContainer(id, true)`等で確定できる
 */
export async function peekContainerElements(id: ContainerID): Promise<Result<Container>> {
  const c = getContainer(id);
  if (!c.ok) return c;

  return switchContainerProcess(
    c.value.type,
    () => box.loadContainerElements(c.value),
    () => local.loadContainerElements(c.value),
    () => cache.loadContainerElements(c.value),
  );
}

/**
 * コンテナを追加する
 */
export async function createContainer(
  type: ContainerType,
  name: string,
  path: string,
): Promise<Result<ContainerSkel>> {
  const newContainer: ContainerSkel = {
    id: ContainerID.parse(uuidv4()),
    name,
    type,
    containerPath: path,
  };

  // コンテナオブジェクトの生成（実データとして`.rd`フォルダを作成する）
  const savedRes = await switchContainerProcess(
    type,
    () => box.saveContainer(newContainer),
    () => local.saveContainer(newContainer),
    () => cache.saveContainer(newContainer),
  );
  if (!savedRes.ok) return savedRes;

  // キャッシュの更新
  cachedContainers[newContainer.id] = newContainer;

  // 読み込み対象一覧に追加
  const settingsRes = await settings.addLoadedContainer(newContainer);
  if (!settingsRes.ok) {
    // コンテナオブジェクトの削除（ロールバック）
    // 設定ファイルへの書きこみで失敗するため，戻り値は無視する
    await unloadContainer(newContainer.id, true);
    return settingsRes;
  }

  // 最近読み込んだコンテナ一覧にも記録する（ベストエフォート：失敗してもコンテナ作成自体は成功とする）
  await settings.addRecentContainer(newContainer);

  // コンテナ内部のElementsの読み取り
  return Success(newContainer);
}

/**
 * コンテナの読み込みを中止する
 */
export async function unloadContainer(
  cId: ContainerID,
  deleteContainer: boolean = false,
): Promise<Result<void>> {
  const c = getContainer(cId);
  if (!c.ok) return c;

  if (deleteContainer) {
    // コンテナオブジェクトを削除（実データとして`.rd`フォルダを削除する）
    const res = await switchContainerProcess(
      c.value.type,
      () => box.deleteContainer(c.value),
      () => local.deleteContainer(c.value),
      () => cache.deleteContainer(c.value),
    );
    if (!res.ok) return res;
  }

  // 読み込み対象一覧から除外
  const settingsRes = await settings.removeLoadedContainer(cId);
  if (!settingsRes.ok) return settingsRes;

  // キャッシュも削除
  delete cachedContainers[cId];

  return Success();
}

/**
 * 一度閉じたコンテナ（または「最近読み込んだコンテナ一覧」にあるコンテナ）を、再び読み込み対象に加える
 *
 * `unloadContainer(id, false)`は実データやリポジトリ側の登録情報自体は残したまま
 * 「読み込み対象のコンテナ」一覧からのみ除外するため、再度読み込み対象に戻すには
 * この関数を経由して`settings.containerSkels`へ登録し直す必要がある
 */
export async function reopenContainer(entry: ContainerSkel): Promise<Result<Container>> {
  cachedContainers[entry.id] = entry;

  const settingsRes = await settings.addLoadedContainer(entry);
  if (!settingsRes.ok) {
    // キャッシュへの登録をロールバック
    delete cachedContainers[entry.id];
    return settingsRes;
  }

  return loadContainer(entry.id, true);
}

/**
 * コンテナ要素を追加する
 */
async function addContainerElement(
  newElement: ContainerElement,
  srcData: DocumentSource,
): Promise<Result<void>> {
  const c = getContainer(newElement.containerID);
  if (!c.ok) return c;

  const parsedContainer = parseContainer(c.value);
  if (!parsedContainer.success) return Failure(new Error('Unloaded container elements'));

  // 要素を追加
  const oldElement = parsedContainer.data.elements[newElement.path];
  if (oldElement !== undefined) {
    newElement.createdAt = oldElement.createdAt;
  }
  parsedContainer.data.elements[newElement.path] = newElement;

  // 実態データの更新
  // TODO: システム外でファイル操作されたときに、コンフリクトを起こす可能性あり
  // （そもそもシステム外でファイル操作された場合、どのようにフロントエンドなどに反映するのか？）
  const createRes = await switchContainerProcess(
    parsedContainer.data.type,
    () => box.createFile(parsedContainer.data, newElement.path, srcData),
    () => local.createFile(parsedContainer.data, newElement.path, srcData),
    () => cache.createFile(parsedContainer.data, newElement.path, srcData),
  );
  if (!createRes.ok) return createRes;

  // キャッシュの更新
  cachedContainers[newElement.containerID] = parsedContainer.data;

  return Success();
}

/**
 * コンテナ要素を削除する
 */
async function deleteContainerElement(
  c: Container,
  deleteElement: ContainerElement,
): Promise<Result<void>> {
  // 要素を削除
  delete c.elements[deleteElement.path];

  // キャッシュの更新
  cachedContainers[c.id] = c;

  // 実態データの更新
  return switchContainerProcess(
    c.type,
    () => box.deleteFile(c, deleteElement),
    () => local.deleteFile(c, deleteElement),
    () => cache.deleteFile(c, deleteElement),
  );
}

/**
 * コンテナ内にファイルを追加する
 */
export async function createFile(
  cId: ContainerID,
  filePathStr: string,
  srcData: DocumentSource,
): Promise<Result<ContainerElementFile>> {
  const fileSize = getBase64FileSize(srcData);
  const element: ContainerElementFile = {
    containerID: cId,
    type: 'File',
    path: filePathStr,
    fileSize: fileSize.ok ? fileSize.value : undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
    description: '',
    genre: '',
    tags: [],
  };

  // コンテナキャッシュの更新 & 実態データの更新
  const container = await addContainerElement(element, srcData);
  if (!container.ok) return container;

  return Success(element);
}

/**
 * コンテナ内のファイルを削除する
 */
export async function deleteFile(
  cId: ContainerID,
  file: ContainerElementFile,
): Promise<Result<void>> {
  const c = getContainer(cId);
  if (!c.ok) return c;

  const parsedContainer = parseContainer(c.value);
  if (!parsedContainer.success) return Failure(new Error('This is not a filled container'));

  // コンテナキャッシュの更新 & 実態データの更新
  return deleteContainerElement(parsedContainer.data, file);
}

/**
 * ファイルからドキュメントの本体データを読みこむ
 */
export async function loadFileAsDocumentSource(
  cId: ContainerID,
  path: string,
): Promise<Result<DocumentSource>> {
  const c = getContainer(cId);
  if (!c.ok) return c;

  // TODO: 実行中の内部キャッシュによる高速化が必須
  // 毎回アクセスしてはいけない

  const srcData = await switchContainerProcess(
    c.value.type,
    () => box.loadSrcData(cId, path),
    () => local.loadSrcData(cId, path),
    () => cache.loadSrcData(cId, path),
  );
  if (!srcData.ok) return srcData;

  return Success(DocumentSource.parse(srcData.value));
}

/**
 * コンテナ内にフォルダを追加する
 */
export async function createFolder(
  cId: ContainerID,
  folderPathStr: string,
): Promise<Result<ContainerElementFolder>> {
  const c = getContainer(cId);
  if (!c.ok) return c;

  const parsedContainer = parseContainer(c.value);
  if (!parsedContainer.success) return Failure(new Error('Unloaded container elements'));

  const element: ContainerElementFolder = {
    containerID: cId,
    type: 'Folder',
    path: folderPathStr,
    createdAt: new Date(),
  };
  parsedContainer.data.elements[element.path] = element;

  const createRes = await switchContainerProcess(
    parsedContainer.data.type,
    () => box.createFolder(parsedContainer.data, element.path),
    () => local.createFolder(parsedContainer.data, element.path),
    () => cache.createFolder(parsedContainer.data, element.path),
  );
  if (!createRes.ok) return createRes;

  cachedContainers[cId] = parsedContainer.data;

  return Success(element);
}

/**
 * コンテナ内のフォルダを削除する（配下の全要素も合わせて削除する）
 */
export async function deleteFolder(
  cId: ContainerID,
  folder: ContainerElementFolder,
): Promise<Result<void>> {
  const c = getContainer(cId);
  if (!c.ok) return c;

  const parsedContainer = parseContainer(c.value);
  if (!parsedContainer.success) return Failure(new Error('This is not a filled container'));

  const prefix = `${folder.path}/`;
  const descendants = Object.values(parsedContainer.data.elements).filter((e) =>
    e.path.startsWith(prefix),
  );

  // 子孫のファイル本体データを先に削除する
  const descendantFiles = descendants.filter((e): e is ContainerElementFile => e.type === 'File');
  for (const file of descendantFiles) {
    delete parsedContainer.data.elements[file.path];
    const delRes = await switchContainerProcess(
      parsedContainer.data.type,
      () => box.deleteFile(parsedContainer.data, file),
      () => local.deleteFile(parsedContainer.data, file),
      () => cache.deleteFile(parsedContainer.data, file),
    );
    if (!delRes.ok) return delRes;
  }

  // 子孫のフォルダ要素情報を削除（実データは持たないため要素マップからの除去のみでよい）
  descendants
    .filter((e) => e.type === 'Folder')
    .forEach((e) => delete parsedContainer.data.elements[e.path]);

  // フォルダ自体の要素情報を削除
  delete parsedContainer.data.elements[folder.path];
  cachedContainers[cId] = parsedContainer.data;

  return switchContainerProcess(
    parsedContainer.data.type,
    () => box.deleteFolder(parsedContainer.data, folder.path),
    () => local.deleteFolder(parsedContainer.data, folder.path),
    () => cache.deleteFolder(parsedContainer.data, folder.path),
  );
}

/**
 * ファイル・フォルダのパスを変更する
 *
 * Fileの場合は1件、Folderの場合は配下の全要素も新パスに付け替えて返す
 * （呼び出し側で`.kcfg`・関係性キャッシュ等の副作用伝播に使えるよう、旧パスと新要素の組で返す）
 */
export async function renamePath(
  cId: ContainerID,
  elem: ContainerElement,
  newPath: string,
): Promise<Result<RenamedEntry[]>> {
  const c = getContainer(cId);
  if (!c.ok) return c;

  const parsedContainer = parseContainer(c.value);
  if (!parsedContainer.success) return Failure(new Error('Unloaded container elements'));

  // Folderの場合、配下のファイル・フォルダを先に処理し終えてから最後にフォルダ自身を処理する
  // （local実装ではフォルダのリネームを「空になったフォルダの付け替え」として扱うため、
  //   配下を先に退避させておく必要がある）
  const targets: ContainerElement[] =
    elem.type === 'File'
      ? [elem]
      : [
          ...Object.values(parsedContainer.data.elements)
            .filter((e) => e.path.startsWith(`${elem.path}/`))
            .sort((a, b) => b.path.split('/').length - a.path.split('/').length),
          elem,
        ];

  const renamed: RenamedEntry[] = [];
  for (const target of targets) {
    const targetNewPath = newPath + target.path.slice(elem.path.length);
    const isFolder = target.type === 'Folder';

    delete parsedContainer.data.elements[target.path];
    const newElement: ContainerElement = { ...target, path: targetNewPath };
    parsedContainer.data.elements[targetNewPath] = newElement;

    const renameRes = await switchContainerProcess(
      parsedContainer.data.type,
      () => box.renameEntry(parsedContainer.data, target.path, targetNewPath, isFolder),
      () => local.renameEntry(parsedContainer.data, target.path, targetNewPath, isFolder),
      () => cache.renameEntry(parsedContainer.data, target.path, targetNewPath, isFolder),
    );
    if (!renameRes.ok) return renameRes;

    renamed.push({ oldPath: target.path, element: newElement });
  }

  cachedContainers[cId] = parsedContainer.data;

  return Success(renamed);
}

/**
 * ファイル・フォルダを別のフォルダ配下へ移動する
 *
 * 内部的にはリネーム（移動先フォルダ + 元の basename）として扱う
 */
export async function moveElement(
  cId: ContainerID,
  elem: ContainerElement,
  newParentPath: string,
): Promise<Result<RenamedEntry[]>> {
  const basename = new Path(elem.path).basename();
  const newPath = new Path(newParentPath).child(basename).path;
  return renamePath(cId, elem, newPath);
}

/**
 * ローカルフォルダを選択する（`createContainer('local', ...)`の直前にUIから呼ぶこと）
 *
 * ブラウザの「ユーザー操作直後のみディレクトリピッカーを開ける」という制約を満たすための入口
 */
export function pickLocalDirectory(): Promise<Result<{ name: string }>> {
  return local.pickDirectory();
}

/**
 * 既に取得済みのディレクトリハンドルを登録する（`.code-workspace`読み込み等で使用）
 */
export function registerLocalDirectoryHandle(
  handle: FileSystemDirectoryHandle,
): Promise<Result<void>> {
  local.registerHandle(handle);
  return Promise.resolve(Success());
}

/**
 * コンテナへのアクセス許可状態を確認する（local型のみ意味を持つ。それ以外は常にgranted扱い）
 */
export async function checkContainerPermission(
  cId: ContainerID,
): Promise<Result<'granted' | 'prompt' | 'denied'>> {
  const c = getContainer(cId);
  if (!c.ok) return c;
  if (c.value.type !== 'local') return Success('granted');
  const checked = await local.checkPermission(cId);
  return checked;
}

/**
 * コンテナへのアクセス許可を再度要求する（再接続ボタン等のユーザー操作から呼ぶこと）
 */
export async function requestContainerPermission(cId: ContainerID): Promise<Result<void>> {
  const c = getContainer(cId);
  if (!c.ok) return c;
  if (c.value.type !== 'local') return Success();
  const requested = await local.requestPermission(cId);
  return requested;
}
