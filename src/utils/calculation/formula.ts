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
