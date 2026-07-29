/**
 * TODO: 将来的にはServiceに格上げして、Repoにはより低層の処理だけを置く？
 * （その場合、CacheはIndexedDBがすでにRepoにあるため、実装なし？）
 */

import type { Container } from 'src/models/container';
import { ContainerElement } from 'src/models/container';
import { ContainerID } from 'src/models/container';
import { ContainerSkel } from 'src/models/container';
import * as db from '../inMemory/IndexedDB';
import type { Result } from 'src/models/error/result';
import { Success } from 'src/models/error/result';
import { DocumentSource } from 'src/models/document/common';
import { fromEntries } from 'src/utils/obj/obj';
import z from 'zod';

/** IndexedDBに仮想のファイル群情報を持たせる */
const SKEL_STORE_NAME = 'virtual-storage-skel';
/** IndexedDBに仮想のファイル属性情報を持たせる */
const ELEM_STORE_NAME = 'virtual-storage-element';
/** IndexedDB内で指定したファイル情報の本体データを保存する */
const SOURCE_STORE_NAME = 'virtual-storage-body';

/**
 * 本体データを保存するストアにおいて、本体データと紐づくキー
 */
function getDocKey(cId: ContainerID, path: string): string {
  return `${cId}-${path}`;
}

/**
 * 要素読み込み前のコンテナ一覧を返す
 */
export async function getContainers(): Promise<Result<ContainerSkel[]>> {
  const containers = await db.getValue(SKEL_STORE_NAME, z.record(ContainerID, ContainerSkel));
  if (!containers.ok) return containers;
  return Success(Object.values(containers.value));
}

/**
 * コンテナを削除する
 */
export async function deleteContainer(c: ContainerSkel): Promise<Result<void>> {
  // コンテナ内のファイルを事前に削除しておく
  const fullContainer = await loadContainerElements(c);
  if (fullContainer.ok) {
    await Promise.all(
      Object.values(fullContainer.value.elements).map((element) =>
        deleteFile(fullContainer.value, element),
      ),
    );
  }

  // コンテナの要素情報とコンテナ情報を削除する
  const elemRes = await db.deleteValue(ELEM_STORE_NAME, c.id);
  if (!elemRes.ok) return elemRes;
  return db.deleteValue(SKEL_STORE_NAME, c.id);
}

/**
 * コンテナを保存する
 */
export async function saveContainer(c: ContainerSkel): Promise<Result<void>> {
  return db.setValue(SKEL_STORE_NAME, c.id, c);
}

/**
 * 指定されたコンテナに最新の要素情報を注入して返す
 */
export async function loadContainerElements(c: ContainerSkel): Promise<Result<Container>> {
  const elems = await db.getValue(ELEM_STORE_NAME, ContainerElement.array().default([]), c.id);
  if (!elems.ok) return elems;
  const elemRecord: Record<string, ContainerElement> = fromEntries(
    elems.value.map((e) => [e.path, e]),
  );

  const container = { ...c, elements: elemRecord };
  return Success(container);
}

/**
 * ファイルの実態を追加する
 *
 * コンテナにはファイル情報が追記済みである前提とする
 */
export async function createFile(
  c: Container,
  filePath: string,
  srcData: DocumentSource,
): Promise<Result<void>> {
  const docKey = getDocKey(c.id, filePath);

  const elemRes = await db.setValue(ELEM_STORE_NAME, c.id, Object.values(c.elements));
  if (!elemRes.ok) return elemRes;

  return db.setValue(SOURCE_STORE_NAME, docKey, srcData);
}

/**
 * ファイルの実態を削除する
 *
 * コンテナにはファイル情報が削除済みである前提とする
 */
export async function deleteFile(c: Container, element: ContainerElement): Promise<Result<void>> {
  const docKey = getDocKey(c.id, element.path);

  const elemRes = await db.setValue(ELEM_STORE_NAME, c.id, Object.values(c.elements));
  if (!elemRes.ok) return elemRes;

  return db.deleteValue(SOURCE_STORE_NAME, docKey);
}

/**
 * ファイルの実態を読み込む
 */
export async function loadSrcData(cId: ContainerID, path: string): Promise<Result<DocumentSource>> {
  const docKey = getDocKey(cId, path);
  return db.getValue(SOURCE_STORE_NAME, DocumentSource, docKey, { notFoundIfMissing: true });
}

/**
 * フォルダの実態を追加する
 *
 * コンテナにはフォルダ情報が追記済みである前提とする（フォルダ自体に本体データはない）
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function createFolder(c: Container, folderPath: string): Promise<Result<void>> {
  return db.setValue(ELEM_STORE_NAME, c.id, Object.values(c.elements));
}

/**
 * フォルダの実態を削除する
 *
 * コンテナには配下も含めフォルダ情報が削除済みである前提とする
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function deleteFolder(c: Container, folderPath: string): Promise<Result<void>> {
  return db.setValue(ELEM_STORE_NAME, c.id, Object.values(c.elements));
}

/**
 * ファイル・フォルダのパスを付け替える
 *
 * コンテナには新パスに更新済みの要素情報が反映されている前提とする
 */
export async function renameEntry(
  c: Container,
  oldPath: string,
  newPath: string,
  isFolder: boolean,
): Promise<Result<void>> {
  const elemRes = await db.setValue(ELEM_STORE_NAME, c.id, Object.values(c.elements));
  if (!elemRes.ok) return elemRes;
  if (isFolder) return Success();

  // ファイルの場合は本体データのキーも付け替える
  const oldKey = getDocKey(c.id, oldPath);
  const newKey = getDocKey(c.id, newPath);
  const srcRes = await db.getValue(SOURCE_STORE_NAME, DocumentSource, oldKey, {
    notFoundIfMissing: true,
  });
  if (!srcRes.ok) return srcRes;

  const setRes = await db.setValue(SOURCE_STORE_NAME, newKey, srcRes.value);
  if (!setRes.ok) return setRes;

  return db.deleteValue(SOURCE_STORE_NAME, oldKey);
}
