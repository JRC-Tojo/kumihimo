import z from 'zod';
import { AnnotationID } from '../document/pdf';
import { ContainerElementFile } from '../container';
import { AnnotationBaseAddress, RelationalCheckedRule, RelationalRule } from './fileSchema';

export const AnnotIDToFile = z.record(AnnotationID, ContainerElementFile);
export type AnnotIDToFile = z.infer<typeof AnnotIDToFile>;

/**
 * 関係性データ
 */
export const Relational = z.object({
  srcID: AnnotationID,
  targetID: AnnotationID,
  rule: RelationalRule,
});
export type Relational = z.infer<typeof Relational>;

/**
 * 関係性データ（バックエンド内ではアドレスとセットで扱う）
 */
export const RelationalWithAddress = z.object({
  relational: Relational,
  srcAddress: AnnotationBaseAddress,
  targetAddress: AnnotationBaseAddress,
});
export type RelationalWithAddress = z.infer<typeof RelationalWithAddress>;

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
