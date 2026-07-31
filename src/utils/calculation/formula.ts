/**
 * アノテーションの抽出値に単位変換等の計算を適用するための、四則演算のみをサポートする
 * 軽量な数式パーサ・評価器
 *
 * 構文エラー・0除算・非有限な結果は例外を投げず`undefined`を返す（呼び出し側は生値のまま
 * 比較へフォールバックする）
 */

/**
 * 文字列を数値として厳密にパースする（前後の空白は許容するが、数字以外の文字が混じる場合は
 * `undefined`を返す）
 */
export function parseNumericValue(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!/^[-+]?\d+(\.\d+)?$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * 計算結果に含まれる浮動小数点演算特有の丸め誤差（例：`100 * 1.09`が`109.00000000000001`に
 * なる等）を吸収する。小数第10位で丸め、`-0`は`0`に正規化する
 */
export function roundFormulaResult(value: number): number {
  const rounded = Math.round(value * 1e10) / 1e10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * `+ - * / ( )` と変数`x`のみからなる数式を評価する
 *
 * 文法: expr := term (('+'|'-') term)* ; term := unary (('*'|'/') unary)* ;
 *       unary := ('+'|'-') unary | primary ; primary := number | 'x' | '(' expr ')'
 */
export function evaluateFormula(formula: string, x: number): number | undefined {
  const state = { pos: 0, text: formula };

  function skipSpaces(): void {
    while (state.pos < state.text.length && /\s/.test(state.text[state.pos] ?? '')) {
      state.pos += 1;
    }
  }

  function peek(): string | undefined {
    skipSpaces();
    return state.text[state.pos];
  }

  function parseNumber(): number {
    skipSpaces();
    const match = /^\d+(\.\d+)?/.exec(state.text.slice(state.pos));
    if (match === null) throw new Error('invalid number literal');
    state.pos += match[0].length;
    return Number(match[0]);
  }

  function parsePrimary(): number {
    const ch = peek();
    if (ch === '(') {
      state.pos += 1;
      const value = parseExpr();
      skipSpaces();
      if (state.text[state.pos] !== ')') throw new Error('expected closing parenthesis');
      state.pos += 1;
      return value;
    }
    if (ch === 'x') {
      state.pos += 1;
      return x;
    }
    if (ch !== undefined && /[0-9.]/.test(ch)) return parseNumber();
    throw new Error('unexpected token');
  }

  function parseUnary(): number {
    const ch = peek();
    if (ch === '+') {
      state.pos += 1;
      return parseUnary();
    }
    if (ch === '-') {
      state.pos += 1;
      return -parseUnary();
    }
    return parsePrimary();
  }

  function parseTerm(): number {
    let value = parseUnary();
    for (;;) {
      const ch = peek();
      if (ch === '*') {
        state.pos += 1;
        value *= parseUnary();
      } else if (ch === '/') {
        state.pos += 1;
        const divisor = parseUnary();
        if (divisor === 0) throw new Error('division by zero');
        value /= divisor;
      } else {
        break;
      }
    }
    return value;
  }

  function parseExpr(): number {
    let value = parseTerm();
    for (;;) {
      const ch = peek();
      if (ch === '+') {
        state.pos += 1;
        value += parseTerm();
      } else if (ch === '-') {
        state.pos += 1;
        value -= parseTerm();
      } else {
        break;
      }
    }
    return value;
  }

  try {
    const result = parseExpr();
    skipSpaces();
    if (state.pos !== state.text.length) throw new Error('unexpected trailing input');
    return Number.isFinite(result) ? result : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 計算式が適用された値を「元の値 計算式 = 結果」の形式に組み立てて表示用に整形する
 * （例：抽出値が「8000」、計算式が「x / 1000」の場合「8000 / 1000 = 8」）。
 * 計算式が無い場合、抽出値が数値化できない場合、式が不正な場合は計算前の生値をそのまま返す
 * （実際の比較検証も、生値のまま比較にフォールバックするのと同じ挙動）
 */
export function formatValueWithFormula(rawValue: string, formula: string | undefined): string {
  if (formula === undefined) return rawValue;

  const x = parseNumericValue(rawValue.normalize('NFKC'));
  if (x === undefined) return rawValue;

  const result = evaluateFormula(formula, x);
  if (result === undefined) return rawValue;

  return `${formula.replaceAll('x', rawValue)} = ${roundFormulaResult(result)}`;
}
