import { describe, expect, test } from 'bun:test';
import { evaluateFormula, formatValueWithFormula, parseNumericValue } from '../formula';

describe('evaluateFormula', () => {
  test('四則演算と演算子の優先順位を評価できる', () => {
    expect(evaluateFormula('2 + 3 * 4', 0)).toBe(14);
    expect(evaluateFormula('(2 + 3) * 4', 0)).toBe(20);
    expect(evaluateFormula('10 / 2 / 5', 0)).toBe(1);
  });

  test('変数xを評価できる（単位変換の例）', () => {
    expect(evaluateFormula('x * 1.09', 100)).toBeCloseTo(109);
    expect(evaluateFormula('(x - 32) / 1.8', 212)).toBeCloseTo(100);
  });

  test('単項マイナス・プラスを扱える', () => {
    expect(evaluateFormula('-x', 5)).toBe(-5);
    expect(evaluateFormula('-(2 + 3)', 0)).toBe(-5);
    expect(evaluateFormula('+5', 0)).toBe(5);
  });

  test('前後の空白を許容する', () => {
    expect(evaluateFormula('  x * 2  ', 3)).toBe(6);
  });

  test('0除算はundefinedを返す', () => {
    expect(evaluateFormula('x / 0', 5)).toBeUndefined();
  });

  test('不正な式はundefinedを返す（例外を投げない）', () => {
    expect(evaluateFormula('x +', 5)).toBeUndefined();
    expect(evaluateFormula('x ** 2', 5)).toBeUndefined();
    expect(evaluateFormula('', 5)).toBeUndefined();
    expect(evaluateFormula('foo(x)', 5)).toBeUndefined();
    expect(evaluateFormula('(x + 1', 5)).toBeUndefined();
  });
});

describe('parseNumericValue', () => {
  test('数値文字列を正しくパースする', () => {
    expect(parseNumericValue('12')).toBe(12);
    expect(parseNumericValue('12.5')).toBe(12.5);
    expect(parseNumericValue('-3')).toBe(-3);
    expect(parseNumericValue('  42  ')).toBe(42);
  });

  test('数値として解釈できない文字列はundefinedを返す', () => {
    expect(parseNumericValue('12abc')).toBeUndefined();
    expect(parseNumericValue('')).toBeUndefined();
    expect(parseNumericValue('   ')).toBeUndefined();
    expect(parseNumericValue('12.')).toBeUndefined();
  });
});

describe('formatValueWithFormula', () => {
  test('計算式が指定されている場合、「元の値 計算式 = 結果」の形式で返す', () => {
    expect(formatValueWithFormula('8000', 'x / 1000')).toBe('8000 / 1000 = 8');
    expect(formatValueWithFormula('100', 'x * 1.09')).toBe('100 * 1.09 = 109');
  });

  test('計算式が未指定の場合は生値をそのまま返す', () => {
    expect(formatValueWithFormula('8000', undefined)).toBe('8000');
  });

  test('生値が数値化できない場合は計算式を適用せず生値のまま返す', () => {
    expect(formatValueWithFormula('N/A', 'x / 1000')).toBe('N/A');
  });

  test('式自体が不正な場合は計算式を適用せず生値のまま返す', () => {
    expect(formatValueWithFormula('8000', 'x / 0')).toBe('8000');
    expect(formatValueWithFormula('8000', 'x **')).toBe('8000');
  });

  test('全角数字の生値でも数値として計算できる', () => {
    expect(formatValueWithFormula('８０００', 'x / 1000')).toBe('８０００ / 1000 = 8');
  });
});
