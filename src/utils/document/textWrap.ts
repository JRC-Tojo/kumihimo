/**
 * 単語単位の折り返し計算（Konva.Textの`wrap:'word'`を近似する、フレームワーク非依存の実装）
 *
 * 半角スペース区切りの単語（英数字等）はできるだけ途中で折り返さない一方、日本語のように
 * 単語境界（スペース）が無い文字列でもCJK文字は1文字ずつ独立したトークンとして扱うことで、
 * 折り返しが一切効かなくなることを避ける。`measureWidth`には呼び出し側の描画エンジンに応じた
 * 文字幅計測関数（Canvas 2Dの`ctx.measureText`やpdf-libの`PDFFont.widthOfTextAtSize`等）を渡す
 */

const CJK_CHAR_SOURCE =
  '\\u3000-\\u303f\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef';
// `\S+`側からCJKを除外し、英数字とCJKが連続する場合もCJKを1文字ずつ切り出せるようにする
const TOKEN_RE = new RegExp(`[${CJK_CHAR_SOURCE}]|[^\\s${CJK_CHAR_SOURCE}]+|\\s+`, 'gu');

/** テキストを、単語（CJK文字は1文字ずつ）単位のトークン列へ分割する */
function tokenize(text: string): string[] {
  return text.match(TOKEN_RE) ?? [];
}

/**
 * 指定した最大幅に収まるよう、テキストを行の配列へ折り返す
 *
 * 明示的な改行（`\n`）は段落区切りとして維持する。1トークン単独でも`maxWidth`を超える場合は
 * そのトークンだけで1行にする（無限ループ・過度な文字単位分割を避けるため、トークン自体を
 * さらに分割することはしない）
 */
export function wrapTextLines(
  text: string,
  maxWidth: number,
  measureWidth: (s: string) => number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const tokens = tokenize(paragraph);
    let current = '';
    for (const token of tokens) {
      const candidate = current + token;
      if (current.trim() !== '' && measureWidth(candidate) > maxWidth) {
        lines.push(current.trimEnd());
        current = token.trimStart();
      } else {
        current = candidate;
      }
    }
    lines.push(current.trimEnd());
  }
  return lines;
}
