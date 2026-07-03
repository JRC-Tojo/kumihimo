import z from 'zod';

// TODO: 将来的にはAnnotationIDは一般要素として分離し、PDFAnnotationとして各ファイル別のアノテーション定義を出す
export const AnnotationID = z.uuidv4().brand('AnnotationID');
export type AnnotationID = z.infer<typeof AnnotationID>;

export const ColorCode = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
  .brand('ColorCode');
export type ColorCode = z.infer<typeof ColorCode>;

/**
 * アノテーションスキーマ
 */
const AnnotationBase = z.object({
  id: AnnotationID,
  pageNumber: z.number().int().positive(),
  x: z.number(),
  y: z.number(),
  color: ColorCode, // 16進カラーコード
  strokeWidth: z.number().optional().default(2),
  opacity: z.number().min(0).max(1).optional(),
  content: z.string().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  comment: z
    .object({
      chat: z.unknown().optional(), // TODO: チャットの形式は要検討
    })
    .default({}),
});
export const BoxAnnotationStyle = AnnotationBase.extend({
  type: z.literal('box'),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});
export type BoxAnnotationStyle = z.infer<typeof BoxAnnotationStyle>;
export const LineAnnotationStyle = AnnotationBase.extend({
  type: z.literal('line'),
  points: z.array(z.number()).length(4),
});
export type LineAnnotationStyle = z.infer<typeof LineAnnotationStyle>;
export const CircleAnnotationStyle = AnnotationBase.extend({
  type: z.literal('circle'),
  radius: z.number().positive(),
});
export type CircleAnnotationStyle = z.infer<typeof CircleAnnotationStyle>;

/**
 * アノテーション本体の情報
 *
 * TODO: これは文書一般のアノテーションとして再編し、現行のStyle実装は`PdfAnnotationStyle`などに変更する
 */
export const AnnotationStyle = z.discriminatedUnion('type', [
  BoxAnnotationStyle,
  LineAnnotationStyle,
  CircleAnnotationStyle,
]);
export type AnnotationStyle = z.infer<typeof AnnotationStyle>;
