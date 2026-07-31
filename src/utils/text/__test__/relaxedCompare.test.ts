import { describe, expect, test } from 'bun:test';
import { normalizeForComparison, relaxedEqual } from '../relaxedCompare';
import { DEFAULT_RELAXATION_OPTIONS } from 'src/models/relational/relaxation';

describe('relaxedEqual', () => {
  test('緩和ルールがすべて無効な場合は完全一致のみ真になる', () => {
    expect(relaxedEqual('abc', 'abc', DEFAULT_RELAXATION_OPTIONS)).toBe(true);
    expect(relaxedEqual('abc', 'ABC', DEFAULT_RELAXATION_OPTIONS)).toBe(false);
  });

  test('ignoreCase: 大文字小文字の違いを無視する', () => {
    const options = { ...DEFAULT_RELAXATION_OPTIONS, ignoreCase: true };
    expect(relaxedEqual('Abc', 'aBC', options)).toBe(true);
  });

  test('ignoreWhitespace: 半角・全角スペースの有無を無視する', () => {
    const options = { ...DEFAULT_RELAXATION_OPTIONS, ignoreWhitespace: true };
    expect(relaxedEqual('a b c', 'abc', options)).toBe(true);
    expect(relaxedEqual('a　b\tc', 'abc', options)).toBe(true);
  });

  test('ignoreWidth: 全角・半角の違いをNFKC正規化で無視する', () => {
    const options = { ...DEFAULT_RELAXATION_OPTIONS, ignoreWidth: true };
    expect(relaxedEqual('１２３', '123', options)).toBe(true);
    expect(relaxedEqual('Ａ', 'A', options)).toBe(true);
    expect(relaxedEqual('１２３', '124', options)).toBe(false);
  });

  test('equivalenceGroups: 指定した文字同士を同一視する', () => {
    const options = {
      ...DEFAULT_RELAXATION_OPTIONS,
      equivalenceGroups: [['×', 'x', 'X']],
    };
    expect(relaxedEqual('10×20', '10x20', options)).toBe(true);
    expect(relaxedEqual('10×20', '10X20', options)).toBe(true);
    expect(relaxedEqual('10×20', '10+20', options)).toBe(false);
  });

  test('複数の緩和ルールを組み合わせられる', () => {
    const options = {
      ignoreCase: true,
      ignoreWhitespace: true,
      ignoreWidth: true,
      equivalenceGroups: [['×', 'x', 'X']],
    };
    expect(relaxedEqual('１０ × ２０', '10X20', options)).toBe(true);
  });

  test('置換グループが重複するグループを持つ場合、後のグループが優先される', () => {
    const options = {
      ...DEFAULT_RELAXATION_OPTIONS,
      equivalenceGroups: [
        ['a', 'x'],
        ['b', 'x'],
      ],
    };
    // 'x' は最初のグループで 'a' に置換された後、2つ目のグループの対象には既に一致しない
    expect(normalizeForComparison('x', options)).toBe('a');
  });
});
