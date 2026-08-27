/**
 * キーごとに非同期処理を1つずつ直列に実行するための汎用ミューテックス
 *
 * 同じキーへの呼び出しは、それ以前に同じキーでキューされた処理が完了する
 * （成功・失敗を問わない）まで待ってから実行される。異なるキー同士は互いに影響しない。
 * `Promise`チェーンのみで実装しており、タイマーやロック解放忘れの心配がない
 */
export interface KeyedMutex {
  runExclusive<T>(key: string, task: () => Promise<T>): Promise<T>;
}

export function createKeyedMutex(): KeyedMutex {
  const queues = new Map<string, Promise<void>>();

  return {
    runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
      const previous = queues.get(key) ?? Promise.resolve();
      const run = previous.then(task, task);
      // キューには「決着した」という事実だけを残す（成功/失敗の値は後続の待機に影響させない）。
      // そうしないと、一度失敗したキーの後続タスクが永久にPromise.reject伝播で止まってしまう
      queues.set(
        key,
        run.then(
          () => undefined,
          () => undefined,
        ),
      );
      return run;
    },
  };
}
