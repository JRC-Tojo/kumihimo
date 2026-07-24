/**
 * ブラウザのキャッシュ（indexedDB）に文書を保存する
 */
import type { Result } from 'src/models/error/result';
import { Failure, Success } from 'src/models/error/result';
import { fromEntries } from 'src/utils/obj/obj';
import { ref } from 'vue';
import type z from 'zod';

/**
 * ローカルストレージリポジトリ
 * IndexedDB とメモリ上のストレージを組み合わせてデータを管理
 */
const dbName = 'KumihimoDB';

let currentVersion = -1;
let db: IDBDatabase | null = null;
const isInitialized = ref(false);

/**
 * IndexedDB の初期化
 */
async function initialize(storeName: string): Promise<Result<void>> {
  return new Promise<Result<void>>((resolve) => {
    const request = indexedDB.open(dbName, currentVersion < 1 ? undefined : currentVersion);

    request.onerror = () => {
      console.error('IndexedDB initialization failed');
      resolve(Failure(new Error(request.error?.message || 'IndexedDB initialization failed')));
    };

    request.onupgradeneeded = (event) => {
      const tmpDb = (event.target as IDBOpenDBRequest).result;

      // ストアの作成
      if (!tmpDb.objectStoreNames.contains(storeName)) {
        tmpDb.createObjectStore(storeName);
      }
    };

    request.onsuccess = async () => {
      db = request.result;
      currentVersion = db.version;

      // 初回起動時に既存のDBがあった場合，onupgradeneededが呼ばれないため，再初期化の必要性を確認する
      if (isNeedInitialize(storeName)) {
        const initRes = await initialize(storeName);
        if (!initRes.ok) resolve(initRes);
      }

      isInitialized.value = true;
      resolve(Success());
    };

    request.onblocked = () => {
      console.warn('IndexedDB open blocked, closing other connections...');
      // 他のタブで使用中の場合のハンドリング
      window.location.reload();
    };
  });
}

/**
 * ストアの初期化が必要か確認する
 */
function isNeedInitialize(storeName: string) {
  if (!db) return true;

  // ストアが存在しない場合、バージョンアップが必要
  if (!db.objectStoreNames.contains(storeName)) {
    currentVersion++;
    db.close();
    return true;
  }

  return false;
}

/**
 * IndexedDBストアへのアクセス処理をPromise<Result>でラップする
 */
function wrapRequest<T>(starter: () => IDBRequest<T>): Promise<Result<T>> {
  return new Promise((resolve) => {
    const req = starter();
    req.onsuccess = () => resolve(Success(req.result));
    req.onerror = () =>
      resolve(Failure(new Error(req.error?.message || 'IndexedDB request failed')));
  });
}

/**
 * ストアから値を取得する
 *
 * @param key 値を取得する対象のキー（指定しない場合はストア全体をRecordで返す）
 */
export async function getValue<T extends z.ZodType>(
  storeName: string,
  targetZodType: T,
  key?: string,
): Promise<Result<z.infer<T>>> {
  if (isNeedInitialize(storeName)) {
    const initRes = await initialize(storeName);
    if (!initRes.ok) return initRes;
  }

  const transaction = db!.transaction([storeName], 'readonly');
  const store = transaction.objectStore(storeName);

  let gotData;
  if (key) {
    const res = await wrapRequest(() => store.get(key));
    if (!res.ok) return res;
    gotData = res.value;
  } else {
    const keys = await wrapRequest(() => store.getAllKeys());
    const values = await wrapRequest(() => store.getAll());
    if (!keys.ok) return keys;
    if (!values.ok) return values;
    gotData = fromEntries(
      keys.value.filter((k) => typeof k === 'string').map((k, i) => [k, values.value[i]]),
    );
  }

  const parsed = targetZodType.safeParse(gotData);
  if (parsed.success) return Success(parsed.data);
  return Failure(parsed.error);
}

/**
 * ストアに値を登録する
 */
export async function setValue<T>(storeName: string, key: string, value: T): Promise<Result<void>> {
  if (isNeedInitialize(storeName)) {
    const initRes = await initialize(storeName);
    if (!initRes.ok) return initRes;
  }

  return new Promise((resolve) => {
    const transaction = db!.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(JSON.parse(JSON.stringify(value)), key);

    request.onsuccess = () => resolve(Success());
    request.onerror = () =>
      resolve(
        Failure(
          new Error(
            request.error?.message || `Failed to set an item (key=${key}) into ${storeName}`,
          ),
        ),
      );
  });
}

/**
 * 登録済みの値を削除する
 */
export async function deleteValue(storeName: string, key: string): Promise<Result<void>> {
  if (isNeedInitialize(storeName)) {
    const initRes = await initialize(storeName);
    if (!initRes.ok) return initRes;
  }

  return new Promise((resolve) => {
    const transaction = db!.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.delete(key);

    request.onsuccess = () => resolve(Success());
    request.onerror = () =>
      resolve(
        Failure(
          new Error(
            request.error?.message || `Failed to delete an item (key=${key}) into ${storeName}`,
          ),
        ),
      );
  });
}
