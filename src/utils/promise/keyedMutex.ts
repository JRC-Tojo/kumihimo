/**
 * キーごとに非同期処理を1つずつ直列に実行するための汎用ミューテックス
 *
 * 同じキーへの呼び出しは、それ以前に同じキーでキューされた処理が完了する
 * （成功・失敗を問わない）まで待ってから実行される。異なるキー同士は互いに影響しない。
 * `Promise`チェーンのみで実装しており、タイマーやロック解放忘れの心配がない
 */
export interface KeyedMutex {
  runExclusive<T>(key: string, task: () => Promise<T>): Promise<T>;
  /** 現在キューにエントリが残っているキーの数（テスト・診断用） */
  size(): number;
}

export function createKeyedMutex(): KeyedMutex {
  const queues = new Map<string, Promise<void>>();

  return {
    runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
      const previous = queues.get(key) ?? Promise.resolve();
      const run = previous.then(task, task);
      // キューには「決着した」という事実だけを残す（成功/失敗の値は後続の待機に影響させない）。
      // そうしないと、一度失敗したキーの後続タスクが永久にPromise.reject伝播で止まってしまう
      const settled = run.then(
        () => undefined,
        () => undefined,
      );
      queues.set(key, settled);

      // 決着後、自分が今もそのキーの最後尾（＝後続のrunExclusive呼び出しがまだ無い）である場合に
      // 限りエントリを削除する。使われたキーを消さずに残し続けると、多数のキー（ファイルパス等）を
      // 使い続ける長時間稼働のアプリではqueuesが単調増加してメモリリークになるため
      void settled.then(() => {
        if (queues.get(key) === settled) queues.delete(key);
      });

      return run;
    },
    size(): number {
      return queues.size;
    },
  };
}
