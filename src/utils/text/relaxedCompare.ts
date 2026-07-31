/**
 * 関係性の等値検証における緩和ルール（大文字小文字・空白・全角半角・文字置換）を適用した文字列比較
 */

import type { RelaxationOptions } from 'src/models/relational/relaxation';

/**
 * 緩和ルールに従い、置換グループ一覧を1文字列に対して適用する
 *
 * 各グループの先頭要素を代表文字（正規化後の値）とし、残りの要素を代表文字に置き換える
 */
function applyEquivalenceGroups(value: string, groups: string[][]): string {
  let result = value;
  for (const group of groups) {
    const [canonical, ...variants] = group;
    if (canonical === undefined) continue;
    for (const variant of variants) {
      if (variant === '') continue;
      result = result.split(variant).join(canonical);
    }
  }
  return result;
}

/**
 * 緩和ルールに従って比較用に文字列を正規化する
 *
 * 全角/半角の吸収（NFKC正規化）を最初に行ってから大文字小文字・空白・置換グループを適用する。
 * こうすることで、例えば全角の「Ｘ」がNFKCで半角「X」に揃ってから、大文字小文字無視や
 * 置換グループ（例：×, x, X を同一視）による判定を正しく受けられる
 */
export function normalizeForComparison(value: string, options: RelaxationOptions): string {
  let v = value;
  if (options.ignoreWidth) v = v.normalize('NFKC');
  if (options.ignoreCase) v = v.toLowerCase();
  if (options.ignoreWhitespace) v = v.replace(/\s+/g, '');
  return applyEquivalenceGroups(v, options.equivalenceGroups);
}

/**
 * 緩和ルールを適用したうえで2つの文字列が一致するかどうかを判定する
 */
export function relaxedEqual(a: string, b: string, options: RelaxationOptions): boolean {
  return normalizeForComparison(a, options) === normalizeForComparison(b, options);
}
