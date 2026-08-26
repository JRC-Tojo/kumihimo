import { describe, expect, test } from 'bun:test';
import {
  evaluateExpression,
  evaluateFormula,
  formatValueWithFormula,
  normalizeNumericString,
  parseNumericValue,
  roundFormulaResult,
} from '../formula';

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

describe('evaluateExpression', () => {
  test('複数の名前付き変数を評価できる（グループの値算出方法の数式モードの例）', () => {
    expect(evaluateExpression('A - B + 3', { A: 10, B: 4 })).toBe(9);
    expect(evaluateExpression('(A + B) / 2', { A: 6, B: 4 })).toBe(5);
  });

  test('単一文字に限らず複数文字の変数名も識別子として扱える', () => {
    expect(evaluateExpression('foo * 2', { foo: 3 })).toBe(6);
  });

  test('未定義の変数を参照した場合はundefinedを返す（ダングリング変数・削除済みメンバー相当）', () => {
    expect(evaluateExpression('A + B', { A: 1 })).toBeUndefined();
  });

  test('0除算・不正な式はundefinedを返す', () => {
    expect(evaluateExpression('A / 0', { A: 1 })).toBeUndefined();
    expect(evaluateExpression('A +', { A: 1 })).toBeUndefined();
  });

  test('evaluateFormulaはevaluateExpressionの単一変数x版として同じ結果を返す', () => {
    expect(evaluateFormula('x * 1.09', 100)).toBe(evaluateExpression('x * 1.09', { x: 100 }));
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

describe('normalizeNumericString', () => {
  test('先頭・末尾の余分な0や符号違いのゼロを吸収する', () => {
    expect(normalizeNumericString('08')).toBe('8');
    expect(normalizeNumericString('8.000')).toBe('8');
    expect(normalizeNumericString('-0')).toBe('0');
    expect(normalizeNumericString('-0.0')).toBe('0');
  });

  test('number型を経由しないため、安全な整数範囲を超えても精度を保つ', () => {
    expect(normalizeNumericString('9007199254740993')).toBe('9007199254740993');
    expect(normalizeNumericString('9007199254740992')).not.toBe(
      normalizeNumericString('9007199254740993'),
    );
  });

  test('数値として解釈できない文字列はundefinedを返す', () => {
    expect(normalizeNumericString('12abc')).toBeUndefined();
  });
});

describe('roundFormulaResult', () => {
  test('浮動小数点演算特有の丸め誤差を吸収する', () => {
    expect(roundFormulaResult(100 * 1.09)).toBe(109);
  });

  test('乗算でオーバーフローしうる非常に大きな値は、桁あふれさせずそのまま返す', () => {
    expect(roundFormulaResult(Number.MAX_VALUE)).toBe(Number.MAX_VALUE);
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
