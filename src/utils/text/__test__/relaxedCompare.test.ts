import { describe, expect, test } from 'bun:test';
import { normalizeForComparison, relaxedEqual } from '../relaxedCompare';
import type { RelaxationOptions } from 'src/models/relational/relaxation';

/**
 * `DEFAULT_RELAXATION_OPTIONS`は既定ですべての緩和項目が有効なため、「特定の1項目だけを
 * 有効にした場合」を検証するテストではここから明示的に無効化したベースラインを使う
 */
const NO_RELAXATION: RelaxationOptions = {
  ignoreCase: false,
  ignoreWhitespace: false,
  ignoreWidth: false,
  numericEquivalence: false,
  equivalenceGroups: [],
};

describe('relaxedEqual', () => {
  test('緩和ルールがすべて無効な場合は完全一致のみ真になる', () => {
    expect(relaxedEqual('abc', 'abc', NO_RELAXATION)).toBe(true);
    expect(relaxedEqual('abc', 'ABC', NO_RELAXATION)).toBe(false);
  });

  test('ignoreCase: 大文字小文字の違いを無視する', () => {
    const options = { ...NO_RELAXATION, ignoreCase: true };
    expect(relaxedEqual('Abc', 'aBC', options)).toBe(true);
  });

  test('ignoreWhitespace: 半角・全角スペースの有無を無視する', () => {
    const options = { ...NO_RELAXATION, ignoreWhitespace: true };
    expect(relaxedEqual('a b c', 'abc', options)).toBe(true);
    expect(relaxedEqual('a　b\tc', 'abc', options)).toBe(true);
  });

  test('ignoreWidth: 全角・半角の違いをNFKC正規化で無視する', () => {
    const options = { ...NO_RELAXATION, ignoreWidth: true };
    expect(relaxedEqual('１２３', '123', options)).toBe(true);
    expect(relaxedEqual('Ａ', 'A', options)).toBe(true);
    expect(relaxedEqual('１２３', '124', options)).toBe(false);
  });

  test('numericEquivalence: 表記が異なっても数値として同じ値なら一致する', () => {
    const options = { ...NO_RELAXATION, numericEquivalence: true };
    expect(relaxedEqual('8', '8.000', options)).toBe(true);
    expect(relaxedEqual('8', '08', options)).toBe(true);
    expect(relaxedEqual('-1.50', '-1.5', options)).toBe(true);
    expect(relaxedEqual('8', '9', options)).toBe(false);
  });

  test('numericEquivalence: どちらかが数値化できない場合は通常の文字列比較にフォールバックする', () => {
    const options = { ...NO_RELAXATION, numericEquivalence: true };
    expect(relaxedEqual('8', '8個', options)).toBe(false);
    expect(relaxedEqual('N/A', 'N/A', options)).toBe(true);
  });

  test('numericEquivalence: 無効な場合は数値としての同一性を考慮しない', () => {
    expect(relaxedEqual('8', '8.000', NO_RELAXATION)).toBe(false);
  });

  test('numericEquivalence: 安全な整数範囲を超える桁数でも精度を落とさず比較する', () => {
    const options = { ...NO_RELAXATION, numericEquivalence: true };
    // number型を経由すると両方とも9007199254740992に丸められ誤って一致してしまう桁数
    expect(relaxedEqual('9007199254740992', '9007199254740993', options)).toBe(false);
    expect(relaxedEqual('9007199254740993', '9007199254740993', options)).toBe(true);
    expect(relaxedEqual('009007199254740993', '9007199254740993', options)).toBe(true);
  });

  test('equivalenceGroups: 指定した文字同士を同一視する', () => {
    const options = {
      ...NO_RELAXATION,
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
      numericEquivalence: true,
      equivalenceGroups: [['×', 'x', 'X']],
    };
    expect(relaxedEqual('１０ × ２０', '10X20', options)).toBe(true);
  });

  test('置換グループが重複するグループを持つ場合、後のグループが優先される', () => {
    const options = {
      ...NO_RELAXATION,
      equivalenceGroups: [
        ['a', 'x'],
        ['b', 'x'],
      ],
    };
    // 'x' は最初のグループで 'a' に置換された後、2つ目のグループの対象には既に一致しない
    expect(normalizeForComparison('x', options)).toBe('a');
  });
});
