/**
 * 関係性の検証結果（OK/NG）をアノテーションの表示に反映する際のスタイル定義
 *
 * docPage.tsへの依存を増やしたくないため、settings.tsからはこのファイルを直接参照する
 */

import z from 'zod';

export const RelationalStatusStyle = z.object({
  strokeColor: z.string(),
  strokeWidth: z.number().min(0),
  fillColor: z.string(),
  fillOpacity: z.number().min(0).max(1),
});
export type RelationalStatusStyle = z.infer<typeof RelationalStatusStyle>;

export const RelationalVerificationStyle = z.object({
  ok: RelationalStatusStyle,
  ng: RelationalStatusStyle,
});
export type RelationalVerificationStyle = z.infer<typeof RelationalVerificationStyle>;

/**
 * デフォルトの検証スタイル（OK: 薄い緑、NG: 赤い太枠）
 */
export const DEFAULT_RELATIONAL_VERIFICATION_STYLE: RelationalVerificationStyle = {
  ok: { strokeColor: '#4CAF50', strokeWidth: 2, fillColor: '#4CAF50', fillOpacity: 0.15 },
  ng: { strokeColor: '#F44336', strokeWidth: 5, fillColor: '#F44336', fillOpacity: 0.08 },
};
