/**
 * コンテナルートに保存するファイルスキーマを定義
 */

import z from 'zod';
import { AnnotationID, AnnotationStyle } from '../document/pdf';
import { ContainerID } from '../container';

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
  // 定数比較する際に用いるプロパティ（未指定の時にはtargetIDとの比較）
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
export type RelationalCheckedRule = z.infer<typeof RelationalCheckedRule>;

/**
 * 関係性データの戻り値として用いる簡易なファイル情報型
 */
export const RelationalFile = z.object({
  cID: ContainerID,
  filePath: z.string(),
});
export type RelationalFile = z.infer<typeof RelationalFile>;

/**
 * アノテーション位置における文書本体の情報
 */
export const AnnotationContext = z.object({
  text: z.string().optional(),
});
export type AnnotationContext = z.infer<typeof AnnotationContext>;

/**
 * アノテーションの詳細な情報
 *
 * TODO: 本当は様々な種類のファイルの`annots`に対応する必要があるが、現状ではPDFのみをサポート
 */
export const AnnotationInfo = z.object({
  style: AnnotationStyle,
  context: AnnotationContext,
});
export type AnnotationInfo = z.infer<typeof AnnotationInfo>;

/**
 * `<<filePath>>/<<fileName>>.rdcfg`として保存するアノテーションファイルスキーマ
 *
 * 関係性情報追跡のためにアノテーション情報は外部化して保存する
 */
export const DocumentConfigFile = z.object({
  fileHash: z.hash('sha256'),
  annots: z.record(AnnotationID, AnnotationInfo),
});
export type DocumentConfigFile = z.infer<typeof DocumentConfigFile>;

/**
 * 関係性情報を伽種ファイルに保存するときのスキーマ
 *
 * フロントエンドとやり取りする型とは別にファイル保存用の型として定義する
 */
export const RelationalInFile = z.object({
  src: AnnotationID,
  target: AnnotationID,
  rule: RelationalRule,
});
export type RelationalInFile = z.infer<typeof RelationalInFile>;

/**
 * AnnotationIDとそのアノテーションが存在するファイルの位置を示す
 */
export const AnnotationBaseAddress = z.object({
  cID: ContainerID,
  filePath: z.string(),
});
export type AnnotationBaseAddress = z.infer<typeof AnnotationBaseAddress>;

/**
 * `.rd/relational.json`に保存するスキーマ
 *
 * 本システムで定義する関係性情報を保存する
 */
export const CachedRelationalFile = z.object({
  // 関係性を定義したアノテーションの位置のみ保存
  annotIdToFileInfo: z.record(AnnotationID, AnnotationBaseAddress),
  relationals: RelationalInFile.array(),
});
export type CachedRelationalFile = z.infer<typeof CachedRelationalFile>;
