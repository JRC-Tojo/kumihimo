import z from 'zod';
import { AnnotationID } from './pdf';

/**
 * アノテーショングループの識別子
 */
export const AnnotationGroupID = z.uuidv4().brand('AnnotationGroupID');
export type AnnotationGroupID = z.infer<typeof AnnotationGroupID>;

/**
 * グループ全体を代表する値をどう算出するかの定義
 *
 * 関係性（Relational）の'equal'ルールでグループを端点にする際、比較に使う値を得るために使う。
 * 将来的な算出方法の追加（平均・連結等）に備えてdiscriminated unionにしておく
 */
export const GroupValueAggregation = z.discriminatedUnion('type', [
  z.object({ type: z.literal('sum') }),
]);
export type GroupValueAggregation = z.infer<typeof GroupValueAggregation>;

/**
 * 複数のアノテーションをまとめて単一のオブジェクトのように扱うためのグループ
 *
 * ネストは許可しない（`memberIds`は常に個々のアノテーションのIDのみを持つ）
 */
export const AnnotationGroup = z.object({
  id: AnnotationGroupID,
  memberIds: AnnotationID.array().min(2),
  // 未設定の間もグループを関係性の端点にできるが、'equal'ルールの検証は常にNGになる
  valueAggregation: GroupValueAggregation.optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AnnotationGroup = z.infer<typeof AnnotationGroup>;
