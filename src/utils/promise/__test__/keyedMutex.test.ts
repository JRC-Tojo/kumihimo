import { describe, expect, it } from 'bun:test';
import { createKeyedMutex } from '../keyedMutex';

/** 非同期テストで指定時間の遅延を生成する */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('createKeyedMutex', () => {
  it('同一キーへの呼び出しは、後から呼ばれても先に完了しても順序通りに直列実行される', async () => {
    const mutex = createKeyedMutex();
    const order: string[] = [];

    // 先に呼び出したタスクの方が処理時間が長くても、後発のタスクは先発の完了を待つこと
    const first = mutex.runExclusive('a', async () => {
      order.push('first-start');
      await delay(30);
      order.push('first-end');
    });
    const second = mutex.runExclusive('a', async () => {
      order.push('second-start');
      await delay(1);
      order.push('second-end');
    });

    await Promise.all([first, second]);

    expect(order).toEqual(['first-start', 'first-end', 'second-start', 'second-end']);
  });

  it('異なるキーへの呼び出しは互いに待たず並行実行される', async () => {
    const mutex = createKeyedMutex();
    const order: string[] = [];

    const slow = mutex.runExclusive('x', async () => {
      order.push('slow-start');
      await delay(30);
      order.push('slow-end');
    });
    const fast = mutex.runExclusive('y', async () => {
      order.push('fast-start');
      await delay(1);
      order.push('fast-end');
    });

    await Promise.all([slow, fast]);

    // 別キーのfastはslowの完了を待たず先に終わること
    expect(order.indexOf('fast-end')).toBeLessThan(order.indexOf('slow-end'));
  });

  it('タスクが失敗しても、同じキーの後続タスクはブロックされずに実行される', async () => {
    const mutex = createKeyedMutex();

    const failing = mutex
      .runExclusive('k', () => Promise.reject(new Error('boom')))
      .catch(() => 'caught');
    const following = mutex.runExclusive('k', () => Promise.resolve('ok'));

    const [failingResult, followingResult] = await Promise.all([failing, following]);
    expect(failingResult).toBe('caught');
    expect(followingResult).toBe('ok');
  });

  it('runExclusiveはタスクの返り値をそのまま返す', async () => {
    const mutex = createKeyedMutex();
    const result = await mutex.runExclusive('k', () => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it('決着後、後続呼び出しが無いキーはqueuesから削除される（メモリリーク防止）', async () => {
    const mutex = createKeyedMutex();

    await mutex.runExclusive('leak-a', () => Promise.resolve());
    await mutex.runExclusive('leak-b', () => Promise.reject(new Error('boom'))).catch(() => {});

    expect(mutex.size()).toBe(0);
  });

  it('決着前に後続呼び出しが積まれたキーは、先発の決着だけでは削除されない', async () => {
    const mutex = createKeyedMutex();

    const first = mutex.runExclusive('k', () => delay(10));
    const second = mutex.runExclusive('k', () => delay(10));

    await delay(15);
    // firstは既に決着済みだが、secondがまだ進行中のためキーは残っているはず
    expect(mutex.size()).toBe(1);

    await Promise.all([first, second]);
    expect(mutex.size()).toBe(0);
  });
});
