/**
 * ブラウザのキャッシュ（indexedDB）に文書を保存する
 */
import type { Result } from 'src/models/error/result';
import { Failure, NotFoundError, Success } from 'src/models/error/result';
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

// 進行中のバージョンアップ処理（`initialize`）を表す。複数の呼び出し元が同時にそれぞれ
// 異なるストアの初期化を必要とした場合、各々が個別に`indexedDB.open`でバージョンアップを
// 試みてしまうと、互いの接続クローズ・再オープンを踏みつけ合い、`db`がcloseされてから
// 再オープンで差し替わるまでの一瞬の間に別の呼び出しがその古い`db`でトランザクションを
// 開始してしまう（"the database connection is closing"）。これを防ぐため、初期化処理は
// 常にこの変数を介して直列化する（`ensureReady`参照）
let pendingReady: Promise<Result<void>> | null = null;

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
      const openedDb = request.result;
      db = openedDb;
      currentVersion = db.version;

      // 他の接続（別タブ、または直後に自分自身が発行するバージョンアップ要求）からの
      // versionchangeを受けたら、このコネクションを自発的にcloseする。これを設定せずに
      // isNeedInitialize側でdb.close()を呼んでから直後にinitializeを再実行すると、
      // close()の完了（非同期・完了通知が無い）を待たずに次のopen()を発行してしまい、
      // 自分自身の直前の接続にブロックされてonblockedへ入ってしまうことがあった
      // （同一タブ内でのバージョンアップ時に発生。closeの完了通知はcloseevent等では
      //   得られないため、versionchangeイベントに委ねるのがIndexedDBの標準的な作法）
      //
      // close()するだけでは`db`変数はこの（もう使えない）接続を指したまま残ってしまい、
      // 以降の`isNeedInitialize`が「db有り」と誤認してこの閉じた接続で読み書きを試み、
      // 失敗し続ける（"the database connection is closing"）。このコネクションが
      // 依然として現在の`db`である場合に限り、`db`/`currentVersion`/`isInitialized`を
      // リセットし、次回`ensureReady`が確実に再接続できるようにする（すでに新しい接続へ
      // 差し替わっている場合、ここでリセットすると新しい接続を巻き添えで無効化してしまうため
      // 対象外とする）
      openedDb.onversionchange = () => {
        openedDb.close();
        if (db === openedDb) {
          db = null;
          currentVersion = -1;
          isInitialized.value = false;
        }
      };

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
      // 他のタブで使用中の場合のハンドリング（上記のonversionchangeでは対応できない、
      // versionchangeに応答しない/古いままの接続が残っているケース向けの最終手段）
      window.location.reload();
    };
  });
}

/**
 * ストアの初期化が必要か確認する
 *
 * ストアが存在しない場合はバージョンアップが必要だが、現在の接続のcloseは呼び出し側では行わない
 * （`initialize`が設定する`db.onversionchange`により、直後に発行される新しいopen()要求への
 * 応答として自発的にcloseされる。ここで先にclose()を呼んでしまうと、その完了を待たずに
 * 次のopen()を発行することになり、自分自身の接続によるonblockedを招きやすい）
 */
function isNeedInitialize(storeName: string) {
  if (!db) return true;

  // ストアが存在しない場合、バージョンアップが必要
  if (!db.objectStoreNames.contains(storeName)) {
    currentVersion++;
    return true;
  }

  return false;
}

/**
 * 指定したストアが利用可能な状態になるまで待つ。
 *
 * 呼び出し時点で他の呼び出し元によるバージョンアップ処理が進行中の場合はそれを待ってから、
 * 自分の要求するストアの有無を改めて確認する（バージョンアップは既存ストアを削除しないため、
 * 他の呼び出しの初期化中に自分の要求するストアも一緒に作られていることがある）。
 * `getValue`/`setValue`/`deleteValue`は必ずこの関数経由でのみ`db`を利用すること
 * （個別に`isNeedInitialize`→`initialize`を呼ぶと、上記の直列化が効かず競合し得る）
 */
async function ensureReady(storeName: string): Promise<Result<void>> {
  if (pendingReady) {
    const res = await pendingReady;
    if (!res.ok) return res;
  }

  if (!isNeedInitialize(storeName)) return Success();

  const initPromise = initialize(storeName);
  pendingReady = initPromise;
  const res = await initPromise;
  if (pendingReady === initPromise) pendingReady = null;
  if (!res.ok) return res;

  // 他の初期化待ちの間に別のバージョンアップが割り込んでいる可能性があるため再確認する
  return ensureReady(storeName);
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
 * @param options.notFoundIfMissing trueの場合、指定したkeyに対応する値がストアに
 * 存在しない際、Zodでのパースを試みる前に`NotFoundError`を返す。「未保存＝空/初期状態」
 * として扱いたい呼び出し元（`local`リポジトリのファイル未存在時の扱いと合わせるため）向け。
 * 指定しない場合は従来通り、未存在時の`undefined`もそのままtargetZodTypeでパースする
 * （スキーマ側の`.default()`等で吸収する既存の呼び出し元の挙動を変えないため）
 */
export async function getValue<T extends z.ZodType>(
  storeName: string,
  targetZodType: T,
  key?: string,
  options?: { notFoundIfMissing?: boolean },
): Promise<Result<z.infer<T>>> {
  const readyRes = await ensureReady(storeName);
  if (!readyRes.ok) return readyRes;

  const transaction = db!.transaction([storeName], 'readonly');
  const store = transaction.objectStore(storeName);

  let gotData;
  if (key) {
    const res = await wrapRequest(() => store.get(key));
    if (!res.ok) return res;
    if (res.value === undefined && options?.notFoundIfMissing) {
      return Failure(new NotFoundError(`Not found (store=${storeName}, key=${key})`));
    }
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
  const readyRes = await ensureReady(storeName);
  if (!readyRes.ok) return readyRes;

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
  const readyRes = await ensureReady(storeName);
  if (!readyRes.ok) return readyRes;

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
