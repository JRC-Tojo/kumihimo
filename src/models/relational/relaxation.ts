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
 */
export const CharEquivalenceGroup = z.string().array().min(1);
export type CharEquivalenceGroup = z.infer<typeof CharEquivalenceGroup>;

export const RelaxationOptions = z.object({
  // 大文字・小文字の別を無視する
  ignoreCase: z.boolean().default(false),
  // スペース（全角スペース含む）の有無を無視する
  ignoreWhitespace: z.boolean().default(false),
  // 全角・半角の別を無視する（NFKC正規化で吸収）
  ignoreWidth: z.boolean().default(false),
  // ユーザー定義の文字置換グループ一覧
  equivalenceGroups: CharEquivalenceGroup.array().optional().default([]),
});
export type RelaxationOptions = z.infer<typeof RelaxationOptions>;

export const DEFAULT_RELAXATION_OPTIONS: RelaxationOptions = {
  ignoreCase: false,
  ignoreWhitespace: false,
  ignoreWidth: false,
  equivalenceGroups: [],
};
