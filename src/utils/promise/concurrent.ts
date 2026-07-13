/**
 * 指定されたタスクを指定された並列数で実行する
 */
export async function runConcurrently<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await tasks[index]!();
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));

  return results;
}
