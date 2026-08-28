/**
 * 「読み込み→計算→書き込み」を対象ごとに直列化して実行する汎用リソース
 *
 * 複数の独立した処理が同じ永続化対象（ファイル等）へ並行して読み込み→書き込みを行うと、
 * 後勝ちの書き込みが間の変更を消してしまう（lost update）。このリソースを経由して
 * 読み書きすることで、呼び出し側は直列化の仕組み（キュー・ロック）を一切意識せず、
 * 好きなタイミングで`read`/`mutate`を呼ぶだけでlost updateが起きないことを保証される。
 * `.kcfg`に限らず、同種の「対象ごとに直列化したい読み書き」全般に再利用できる
 */
import { createKeyedMutex } from './keyedMutex';
import { Success, type Result } from 'src/models/error/result';

/** `mutate`が返す、書き込む次の状態と呼び出し元へ返す結果の組 */
export interface MutationOutcome<TState, T> {
  next: TState;
  result: T;
}

export interface SerializedResource<TItem, TState, TWriteMeta = void> {
  /** 直列化キューを通して最新の状態を読み込む */
  read(item: TItem): Promise<Result<TState>>;
  /**
   * 「読み込み→計算→書き込み」を1つの直列化されたトランザクションとして実行する。
   * `fn`が失敗（`ok: false`）を返した場合は書き込みを行わずそのまま返す。
   * 同じ`item`（＝同じキー）への他の`read`/`mutate`呼び出しとは自動的に直列化されるため、
   * `fn`が受け取る`current`は必ずその時点の最新状態であり、lost updateは起きない
   */
  mutate<T>(
    item: TItem,
    fn: (
      current: TState,
    ) => Promise<Result<MutationOutcome<TState, T>>> | Result<MutationOutcome<TState, T>>,
    meta: TWriteMeta,
  ): Promise<Result<T>>;
  /**
   * `readForMutate`（事前条件チェック）を行わず、`compute`が返す新しい状態を直接書き込む。
   * 同じ`item`への他の`read`/`mutate`/`write`呼び出しとは自動的に直列化される。
   *
   * `mutate`は「現在の状態を前提に次の状態を計算する」更新用で、事前条件（`.kcfg`のような
   * バージョン・ハッシュチェック）を`readForMutate`で検証してから`fn`を呼ぶ。しかし外部で
   * 更新された内容をユーザーの明示的な操作で受け入れる（コンフリクト解決）ような場合は、
   * その事前条件チェック自体を意図的にバイパスする必要があるため、この専用の経路を使う
   */
  write<T>(
    item: TItem,
    compute: () => Promise<Result<MutationOutcome<TState, T>>> | Result<MutationOutcome<TState, T>>,
    meta: TWriteMeta,
  ): Promise<Result<T>>;
}

/**
 * `keyOf`で対象を一意なキーへ変換し、そのキー単位で`io.read`/`io.write`を直列化した
 * {@link SerializedResource}を組み立てる。実際のI/O内容（ファイル読み書き等）は
 * `io`として呼び出し側が渡す。
 *
 * `io.read`が副作用（他ストアへの同期処理等）を伴う場合、`mutate`の内部読み込みにも同じ
 * `read`を使うと、書き込み直前に「読み込み時点でまだ反映されていない古い状態」を副作用先へ
 * 同期してしまい、直後の正しい書き込みで上書きされるまでの間、副作用先の状態が一瞬
 * 巻き戻って見えることがある（`mutate`はこれから新しい状態を書き込む前提であり、
 * 副作用先は既に呼び出し元の別の処理によって正しい状態になっている場合があるため）。
 * このような副作用を持つ`read`を使う場合は、副作用なしの読み込みを`io.readForMutate`として
 * 別途渡すこと（省略時は`io.read`がそのまま使われる）
 */
export function createSerializedResource<TItem, TState, TWriteMeta = void>(
  keyOf: (item: TItem) => string,
  io: {
    read: (item: TItem) => Promise<Result<TState>>;
    readForMutate?: (item: TItem) => Promise<Result<TState>>;
    write: (item: TItem, next: TState, meta: TWriteMeta) => Promise<Result<void>>;
  },
): SerializedResource<TItem, TState, TWriteMeta> {
  const mutex = createKeyedMutex();
  const readForMutate = io.readForMutate ?? io.read;

  return {
    read(item) {
      return mutex.runExclusive(keyOf(item), () => io.read(item));
    },

    async mutate(item, fn, meta) {
      return mutex.runExclusive(keyOf(item), async () => {
        const current = await readForMutate(item);
        if (!current.ok) return current;

        const mutated = await fn(current.value);
        if (!mutated.ok) return mutated;

        const saveRes = await io.write(item, mutated.value.next, meta);
        if (!saveRes.ok) return saveRes;

        return Success(mutated.value.result);
      });
    },

    async write(item, compute, meta) {
      return mutex.runExclusive(keyOf(item), async () => {
        const computed = await compute();
        if (!computed.ok) return computed;

        const saveRes = await io.write(item, computed.value.next, meta);
        if (!saveRes.ok) return saveRes;

        return Success(computed.value.result);
      });
    },
  };
}
