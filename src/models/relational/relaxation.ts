/**
 * 関係性の等値検証を「完全一致」より緩やかに判定するための緩和ルールを定義
 *
 * アプリ設定（グローバル既定値）とアノテーション別設定（`RelationalEqRule.relaxation`）の
 * 両方から参照されるため、循環importを避けるための独立した葉スキーマファイルとする
 * （style.tsと同じ位置づけ）
 */

import z from 'zod';

/**
 * 同一視する文字のグループ（例：`×`, `x`, `X`）。先頭要素が正規化後の代表文字になる
 *
 * 各要素は空文字を許容しない（空文字はどんな文字列にも一致してしまい、意図しない置換を
 * 引き起こすため）。UI側では入力途中の空欄を保存前に取り除く（`sanitizeRelaxationOptions`）
 */
export const CharEquivalenceGroup = z.string().min(1).array().min(1);
export type CharEquivalenceGroup = z.infer<typeof CharEquivalenceGroup>;

export const RelaxationOptions = z.object({
  // 大文字・小文字の別を無視する
  ignoreCase: z.boolean().default(true),
  // スペース（全角スペース含む）の有無を無視する
  ignoreWhitespace: z.boolean().default(true),
  // 全角・半角の別を無視する（NFKC正規化で吸収）
  ignoreWidth: z.boolean().default(true),
  // 数値として意味が同じであれば一致とみなす（例：「8」と「8.000」、「08」）
  numericEquivalence: z.boolean().default(true),
  // ユーザー定義の文字置換グループ一覧
  equivalenceGroups: CharEquivalenceGroup.array().optional().default([]),
});
export type RelaxationOptions = z.infer<typeof RelaxationOptions>;

/**
 * 既定の緩和ルール
 *
 * 緩和項目はすべて有効化しておき、初期状態でも表記ゆれをできる限り許容するようにする。
 * 同一視する文字グループには、掛け算記号の異表記（×, x, X, *）を例として最初から含めておく
 */
export const DEFAULT_RELAXATION_OPTIONS: RelaxationOptions = {
  ignoreCase: true,
  ignoreWhitespace: true,
  ignoreWidth: true,
  numericEquivalence: true,
  equivalenceGroups: [['×', 'x', 'X', '*']],
};
