import { describe, expect, it } from 'bun:test';
import { toEntries, fromEntries } from '../obj';

describe('toEntries/fromEntries', () => {
  it('toEntriesはオブジェクトを[key, value]配列に変換する', () => {
    expect(toEntries({ a: 1, b: 2 })).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
  });

  it('fromEntriesは[key, value]配列をオブジェクトへ戻す', () => {
    expect(
      fromEntries([
        ['a', 1],
        ['b', 2],
      ]),
    ).toEqual({ a: 1, b: 2 });
  });

  it('toEntries/fromEntriesは相互に可逆である', () => {
    const original = { x: 'foo', y: 'bar' };
    expect(fromEntries(toEntries(original))).toEqual(original);
  });
});
