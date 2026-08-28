import { describe, expect, it } from 'bun:test';
import { Success, Failure, type Result } from 'src/models/error/result';
import { createSerializedResource } from '../serializedResource';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface FakeState {
  values: string[];
}

/**
 * インメモリの擬似ストア。`read`に人為的な遅延を入れることで、直列化されていなければ
 * 2つの`mutate`呼び出しが互いのcurrentを読み違えて上書きし合う（lost update）ことを
 * 意図的に起きやすくする
 */
function createFakeStore(readDelayMs: number) {
  const store = new Map<string, FakeState>();

  return {
    store,
    read: async (key: string): Promise<Result<FakeState>> => {
      const current = store.get(key) ?? { values: [] };
      await delay(readDelayMs);
      // 読み込み時点のスナップショットを返す（参照ではなくコピー）
      return Success({ values: [...current.values] });
    },
    write: (key: string, next: FakeState): Promise<Result<void>> => {
      store.set(key, { values: [...next.values] });
      return Promise.resolve(Success());
    },
  };
}

describe('createSerializedResource', () => {
  it('同じキーへの2つのmutateを同時に発火しても、両方の変更が最終状態に残る（lost updateが起きない）', async () => {
    const fake = createFakeStore(20);
    const resource = createSerializedResource<string, FakeState, void>((key) => key, {
      read: fake.read,
      write: fake.write,
    });

    const append = (value: string) =>
      resource.mutate(
        'file-a',
        (current) => Success({ next: { values: [...current.values, value] }, result: undefined }),
        undefined,
      );

    // 直列化されていなければ、両方とも同じ空配列を読み込んでそれぞれ1件だけ追加した状態で
    // 上書きし合い、どちらか一方が消えてしまう
    await Promise.all([append('one'), append('two')]);

    expect(fake.store.get('file-a')?.values.sort()).toEqual(['one', 'two']);
  });

  it('異なるキーへのmutateは互いに影響しない', async () => {
    const fake = createFakeStore(5);
    const resource = createSerializedResource<string, FakeState, void>((key) => key, {
      read: fake.read,
      write: fake.write,
    });

    await Promise.all([
      resource.mutate(
        'file-a',
        (current) => Success({ next: { values: [...current.values, 'a1'] }, result: undefined }),
        undefined,
      ),
      resource.mutate(
        'file-b',
        (current) => Success({ next: { values: [...current.values, 'b1'] }, result: undefined }),
        undefined,
      ),
    ]);

    expect(fake.store.get('file-a')?.values).toEqual(['a1']);
    expect(fake.store.get('file-b')?.values).toEqual(['b1']);
  });

  it('mutateのfnが失敗を返した場合は書き込みを行わず、そのままFailureを返す', async () => {
    const fake = createFakeStore(1);
    const resource = createSerializedResource<string, FakeState, void>((key) => key, {
      read: fake.read,
      write: fake.write,
    });

    const err = new Error('invalid');
    const res = await resource.mutate('file-a', () => Failure(err), undefined);

    expect(res.ok).toBe(false);
    expect(fake.store.has('file-a')).toBe(false);
  });

  it('readは直列化キューを通して最新状態を返す', async () => {
    const fake = createFakeStore(1);
    const resource = createSerializedResource<string, FakeState, void>((key) => key, {
      read: fake.read,
      write: fake.write,
    });

    await resource.mutate(
      'file-a',
      (current) => Success({ next: { values: [...current.values, 'x'] }, result: undefined }),
      undefined,
    );
    const res = await resource.read('file-a');

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.values).toEqual(['x']);
  });

  it('write用の追加メタ情報（meta）をmutateからioの書き込みへそのまま渡せる', async () => {
    const fake = createFakeStore(1);
    let receivedMeta: string | undefined;
    const resource = createSerializedResource<string, FakeState, string>((key) => key, {
      read: fake.read,
      write: (key, next, meta) => {
        receivedMeta = meta;
        return fake.write(key, next);
      },
    });

    await resource.mutate(
      'file-a',
      (current) => Success({ next: { values: current.values }, result: undefined }),
      'backup-mode',
    );

    expect(receivedMeta).toBe('backup-mode');
  });

  it('readForMutateを指定すると、mutateの内部読み込みはreadではなくreadForMutateを使う', async () => {
    const fake = createFakeStore(1);
    let readCalls = 0;
    let readForMutateCalls = 0;
    const resource = createSerializedResource<string, FakeState, void>((key) => key, {
      read: (key) => {
        readCalls += 1;
        return fake.read(key);
      },
      readForMutate: (key) => {
        readForMutateCalls += 1;
        return fake.read(key);
      },
      write: fake.write,
    });

    await resource.mutate(
      'file-a',
      (current) => Success({ next: { values: [...current.values, 'x'] }, result: undefined }),
      undefined,
    );
    expect(readForMutateCalls).toBe(1);
    expect(readCalls).toBe(0);

    await resource.read('file-a');
    expect(readCalls).toBe(1);
    expect(readForMutateCalls).toBe(1);
  });

  it('readForMutateを省略した場合はreadがmutateの内部読み込みにも使われる（既定動作）', async () => {
    const fake = createFakeStore(1);
    let readCalls = 0;
    const resource = createSerializedResource<string, FakeState, void>((key) => key, {
      read: (key) => {
        readCalls += 1;
        return fake.read(key);
      },
      write: fake.write,
    });

    await resource.mutate(
      'file-a',
      (current) => Success({ next: { values: [...current.values, 'x'] }, result: undefined }),
      undefined,
    );
    expect(readCalls).toBe(1);
  });
});
