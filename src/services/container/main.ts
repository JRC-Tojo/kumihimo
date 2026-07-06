/**
 * コンテナに関する操作を提供する
 */

import type {
  ContainerElement,
  ContainerElementFile,
  ContainerSkel,
  ContainerType,
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
 * コンテナ要素であるファイル情報などは未取得の状態で返す
 */
export async function getAllContainers(): Promise<Result<ContainerSkel[]>> {
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
      .flat(),
  );

  return Success(Object.values(cachedContainers));
}

/**
 * コンテナ情報を読み込む
 *
 * コンテナ要素まですべて読み込む
 */
export async function loadContainer(id: ContainerID): Promise<Result<Container>> {
  const c = getContainer(id);
  if (!c.ok) return c;

  // キャッシュがすでに入っている場合はそのデータを返す
  const cached = parseContainer(c.value);
  if (cached.success) return Success(cached.data);

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

  return loadedContainer;
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
