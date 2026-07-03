import z from 'zod';
import { AnnotationID } from '../document/pdf';
import { ContainerElementFile, ContainerID } from '../container';

export const AnnotIDToFile = z.record(AnnotationID, ContainerElementFile);
export type AnnotIDToFile = z.infer<typeof AnnotIDToFile>;

/**
 * リンクのみの関係性
 */
export const RelationalLinkRule = z.object({
  type: z.literal('link'),
});
export type RelationalLinkRule = z.infer<typeof RelationalLinkRule>;
/**
 * 値が等しいことを保証する関係性
 */
export const RelationalEqRule = z.object({
  type: z.literal('equal'),
  // 定数比較する際に用いるプロパティ（未指定の時にはtargetIDsとの比較）
  constVal: z.string().optional(),
});
export type RelationalEqRule = z.infer<typeof RelationalEqRule>;
/**
 * 関係性のルール
 */
export const RelationalRule = z.discriminatedUnion('type', [RelationalLinkRule, RelationalEqRule]);
export type RelationalRule = z.infer<typeof RelationalRule>;

/**
 * 関係性ルールの検証結果
 */
export const RelationalCheckedRule = z.object({
  rule: RelationalRule,
  isOK: z.boolean(),
});

/**
 * 関係性データの戻り値として用いる簡易なファイル情報型
 */
export const RelationalFile = z.object({
  cID: ContainerID,
  filePath: z.string(),
});
export type RelationalFile = z.infer<typeof RelationalFile>;

/**
 * 関係性データ
 */
export const Relational = z.object({
  srcFile: RelationalFile,
  srcID: AnnotationID,
  targetFile: RelationalFile,
  targetID: AnnotationID,
  rule: RelationalRule,
});
export type Relational = z.infer<typeof Relational>;

/**
 * 関係性データの検証結果
 */
export const RelationalResponce = z.object({
  srcID: AnnotationID,
  targetID: AnnotationID,
  srcVal: z.string(),
  targetVal: z.string(),
  checkedRule: RelationalCheckedRule,
});
export type RelationalResponce = z.infer<typeof RelationalResponce>;
