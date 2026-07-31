import { describe, expect, test } from 'bun:test';
import { evaluateFormula, parseNumericValue } from '../formula';

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
