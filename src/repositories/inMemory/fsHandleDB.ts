/**
 * File System Access APIの`FileSystemDirectoryHandle`を永続化する専用ストア
 *
 * `FileSystemHandle`はJSONへシリアライズできない（`JSON.stringify`が`{}`になる）ため、
 * JSON変換を挟む既存の`repositories/inMemory/IndexedDB.ts`は使えず、
 * IndexedDBが標準でサポートするstructured cloneをそのまま利用してhandleを保存する
 */
import type { ContainerID, ContainerSkel } from 'src/models/container';
import type { Result } from 'src/models/error/result';
import { Failure, Success } from 'src/models/error/result';

const DB_NAME = 'RelationalDocumentsFsHandles';
const STORE_NAME = 'directory-handles';

export interface StoredHandle {
  skel: ContainerSkel;
  handle: FileSystemDirectoryHandle;
}

let db: IDBDatabase | null = null;

/**
 * ストア用DBを開く（初回のみ作成）
 */
function openDb(): Promise<Result<IDBDatabase>> {
  if (db) return Promise.resolve(Success(db));

  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const tmpDb = request.result;
      if (!tmpDb.objectStoreNames.contains(STORE_NAME)) {
        tmpDb.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(Success(db));
    };

    request.onerror = () => {
      resolve(Failure(new Error(request.error?.message || 'Failed to open fsHandleDB')));
    };
  });
}

/**
 * IDBRequestをPromise<Result>でラップする
 */
function wrapRequest<T>(starter: () => IDBRequest<T>): Promise<Result<T>> {
  return new Promise((resolve) => {
    const req = starter();
    req.onsuccess = () => resolve(Success(req.result));
    req.onerror = () =>
      resolve(Failure(new Error(req.error?.message || 'fsHandleDB request failed')));
  });
}

/**
 * readwriteトランザクションの完了（`oncomplete`）まで待機する
 *
 * リクエスト（`put`/`delete`）自体の成功だけで返すと、トランザクションが後から
 * abortされた場合（クォータ超過等）を取りこぼすため、コミット完了まで確認する
 */
function wrapTransaction(transaction: IDBTransaction): Promise<Result<void>> {
  return new Promise((resolve) => {
    transaction.oncomplete = () => resolve(Success());
    transaction.onabort = () =>
      resolve(Failure(new Error(transaction.error?.message || 'fsHandleDB transaction aborted')));
    transaction.onerror = () =>
      resolve(Failure(new Error(transaction.error?.message || 'fsHandleDB transaction failed')));
  });
}

/**
 * ハンドルを保存する
 */
export async function setHandle(cId: ContainerID, value: StoredHandle): Promise<Result<void>> {
  const dbRes = await openDb();
  if (!dbRes.ok) return dbRes;

  const transaction = dbRes.value.transaction(STORE_NAME, 'readwrite');
  const putRes = await wrapRequest(() => transaction.objectStore(STORE_NAME).put(value, cId));
  if (!putRes.ok) return putRes;
  return wrapTransaction(transaction);
}

/**
 * ハンドルを取得する
 */
export async function getHandle(cId: ContainerID): Promise<Result<StoredHandle>> {
  const dbRes = await openDb();
  if (!dbRes.ok) return dbRes;

  const store = dbRes.value.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME);
  const res = await wrapRequest<StoredHandle | undefined>(() => store.get(cId));
  if (!res.ok) return res;
  if (res.value === undefined) return Failure(new Error(`Not Found Handle (id: ${cId})`));
  return Success(res.value);
}

/**
 * ハンドルを削除する
 */
export async function deleteHandle(cId: ContainerID): Promise<Result<void>> {
  const dbRes = await openDb();
  if (!dbRes.ok) return dbRes;

  const transaction = dbRes.value.transaction(STORE_NAME, 'readwrite');
  const delRes = await wrapRequest(() => transaction.objectStore(STORE_NAME).delete(cId));
  if (!delRes.ok) return delRes;
  return wrapTransaction(transaction);
}

/**
 * 保存済みの全ハンドルを取得する
 */
export async function getAllHandles(): Promise<Result<StoredHandle[]>> {
  const dbRes = await openDb();
  if (!dbRes.ok) return dbRes;

  const store = dbRes.value.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME);
  return wrapRequest(() => store.getAll());
}
