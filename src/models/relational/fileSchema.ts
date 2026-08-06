/**
 * コンテナルートに保存するファイルスキーマを定義
 */

import z from 'zod';
import { AnnotationID, AnnotationStyle } from '../document/pdf';
import { ContainerID } from '../container';
import { RelaxationOptions } from './relaxation';

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
  // アノテーション別の緩和ルール。未指定時はAppSettings.relationalRelaxationにフォールバックする
  // （アプリ設定との合成ではなく完全上書き）
  relaxation: RelaxationOptions.optional(),
  // src側の値に適用する四則演算式（変数xにOCR抽出値を数値化したものを代入して評価する）。
  // 数値化できない場合は計算を適用せず生値のまま比較する
  srcFormula: z.string().optional(),
  // target側についての同上
  targetFormula: z.string().optional(),
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
 * ブックマークの識別子
 */
export const BookmarkID = z.uuidv4().brand('BookmarkID');
export type BookmarkID = z.infer<typeof BookmarkID>;

/**
 * ユーザーが本システム側で登録したブックマーク（文書内の特定ページへの目印）
 *
 * PDF自体に埋め込まれたしおり（アウトライン、`PdfOutlineEntry`）とは別物で、
 * こちらは`.kcfg`に保存され、登録・削除・改名が可能
 */
export const BookmarkInfo = z.object({
  id: BookmarkID,
  title: z.string(),
  pageNumber: z.number().int().positive(),
});
export type BookmarkInfo = z.infer<typeof BookmarkInfo>;

/**
 * `<<filePath>>/<<fileName>>.kcfg`として保存するアノテーションファイルスキーマ
 *
 * 関係性情報追跡のためにアノテーション情報は外部化して保存する
 */
export const DocumentConfigFile = z.object({
  fileHash: z.hash('sha256'),
  annots: z.record(AnnotationID, AnnotationInfo),
  // 既存の.kcfgにはこのフィールドが無いため、読み込み時は空のオブジェクトを既定値とする
  bookmarks: z.record(BookmarkID, BookmarkInfo).optional().default({}),
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
 * `.kumihimo/relational.json`に保存するスキーマ
 *
 * 本システムで定義する関係性情報を保存する
 */
export const CachedRelationalFile = z.object({
  // 関係性を定義したアノテーションの位置のみ保存
  annotIdToFileInfo: z.record(AnnotationID, AnnotationBaseAddress),
  relationals: RelationalInFile.array(),
});
export type CachedRelationalFile = z.infer<typeof CachedRelationalFile>;
