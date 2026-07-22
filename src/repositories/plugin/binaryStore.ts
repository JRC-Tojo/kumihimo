/**
 * プラグイン本体（WASMバイト列）を保存する専用ストア
 *
 * `Uint8Array`はJSONへ変換すると壊れる（`src/repositories/inMemory/IndexedDB.ts`は内部で
 * JSON round-tripを行うため使えない）ため、`src/repositories/inMemory/fsHandleDB.ts`と同じく
 * IndexedDBが標準でサポートするstructured cloneをそのまま利用して保存する
 */
import type { PluginID } from 'src/models/plugin/manifest';
import type { Result } from 'src/models/error/result';
import { Failure, Success, toError } from 'src/models/error/result';

const DB_NAME = 'RelationalDocumentsPluginBinaries';
const STORE_NAME = 'plugin-binaries';

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
      resolve(Failure(new Error(request.error?.message || 'Failed to open plugin binaryStore')));
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
      resolve(Failure(new Error(req.error?.message || 'plugin binaryStore request failed')));
  });
}

/**
 * readwriteトランザクションの完了（`oncomplete`）まで待機する
 */
function wrapTransaction(transaction: IDBTransaction): Promise<Result<void>> {
  return new Promise((resolve) => {
    transaction.oncomplete = () => resolve(Success());
    transaction.onabort = () =>
      resolve(
        Failure(new Error(transaction.error?.message || 'plugin binaryStore transaction aborted')),
      );
    transaction.onerror = () =>
      resolve(
        Failure(new Error(transaction.error?.message || 'plugin binaryStore transaction failed')),
      );
  });
}

/**
 * プラグイン本体のバイト列を保存する
 */
export async function setBinary(pluginId: PluginID, bytes: Uint8Array): Promise<Result<void>> {
  const dbRes = await openDb();
  if (!dbRes.ok) return dbRes;

  try {
    const transaction = dbRes.value.transaction(STORE_NAME, 'readwrite');
    const putRes = await wrapRequest(() =>
      transaction.objectStore(STORE_NAME).put(bytes, pluginId),
    );
    if (!putRes.ok) return putRes;
    return await wrapTransaction(transaction);
  } catch (e) {
    return Failure(toError(e));
  }
}

/**
 * プラグイン本体のバイト列を取得する
 */
export async function getBinary(pluginId: PluginID): Promise<Result<Uint8Array>> {
  const dbRes = await openDb();
  if (!dbRes.ok) return dbRes;

  try {
    const store = dbRes.value.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME);
    const res = await wrapRequest<Uint8Array | undefined>(() => store.get(pluginId));
    if (!res.ok) return res;
    if (res.value === undefined)
      return Failure(new Error(`Not Found Plugin Binary (id: ${pluginId})`));
    return Success(res.value);
  } catch (e) {
    return Failure(toError(e));
  }
}

/**
 * プラグイン本体のバイト列を削除する
 */
export async function deleteBinary(pluginId: PluginID): Promise<Result<void>> {
  const dbRes = await openDb();
  if (!dbRes.ok) return dbRes;

  try {
    const transaction = dbRes.value.transaction(STORE_NAME, 'readwrite');
    const delRes = await wrapRequest(() => transaction.objectStore(STORE_NAME).delete(pluginId));
    if (!delRes.ok) return delRes;
    return await wrapTransaction(transaction);
  } catch (e) {
    return Failure(toError(e));
  }
}
