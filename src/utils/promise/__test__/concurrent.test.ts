import { describe, expect, it } from 'bun:test';
import { runConcurrently } from '../concurrent';

function delayed<T>(value: T, ms: number): () => Promise<T> {
  return () => new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

describe('runConcurrently', () => {
  it('全タスクを実行し、完了順ではなく元の並び順で結果を返す', async () => {
    // 先に投入したタスクほど遅く終わるようにし、完了順どおりなら結果が入れ替わることを確認する
    const tasks = [delayed('a', 30), delayed('b', 10), delayed('c', 0)];
    const results = await runConcurrently(tasks, 3);
    expect(results).toEqual(['a', 'b', 'c']);
  });

  it('同時実行数を指定した上限までに絞る', async () => {
    let current = 0;
    let maxObserved = 0;
    const task = () => async () => {
      current++;
      maxObserved = Math.max(maxObserved, current);
      await new Promise((resolve) => setTimeout(resolve, 10));
      current--;
      return null;
    };
    const tasks = Array.from({ length: 8 }, task);
    await runConcurrently(tasks, 3);
    expect(maxObserved).toBeLessThanOrEqual(3);
    expect(maxObserved).toBeGreaterThan(1); // 直列実行(=1)ではなく実際に並列化されていること
  });

  it('タスクが空配列の場合は空配列を返す', async () => {
    const results = await runConcurrently<number>([], 3);
    expect(results).toEqual([]);
  });

  it('同時実行数がタスク数より多い場合でも全件実行される', async () => {
    const tasks = [delayed(1, 0), delayed(2, 0)];
    const results = await runConcurrently(tasks, 10);
    expect(results).toEqual([1, 2]);
  });

  it('いずれかのタスクが失敗した場合、そのエラーで拒否される', async () => {
    const tasks = [delayed('ok', 0), () => Promise.reject(new Error('boom')), delayed('ok2', 0)];
    let caught: unknown;
    try {
      await runConcurrently(tasks, 2);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('boom');
  });
});
