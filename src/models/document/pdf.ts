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
 * 線種（破線・点線等）
 */
export const StrokeType = z.enum(['solid', 'dashed', 'dotted', 'dash-dot']);
export type StrokeType = z.infer<typeof StrokeType>;

/**
 * アノテーションを下地の文書・他のアノテーションへ合成する際のブレンドモード
 *
 * CSSの`mix-blend-mode`・CanvasContext2Dの`globalCompositeOperation`双方で共通して使える
 * 標準的なブレンドモード名をそのまま値として使う（'normal'のみCanvas側では'source-over'に読み替える。
 * `utils/document/blendMode.ts`参照）
 */
export const BlendMode = z.enum([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
]);
export type BlendMode = z.infer<typeof BlendMode>;

const AnnotationBase = z.object({
  id: AnnotationID,
  pageNumber: z.number().int().positive(),
  x: z.number(),
  y: z.number(),
  color: ColorCode.optional(), // 16進カラーコード。未設定は「線色なし」を表す
  strokeWidth: z.number().optional().default(2),
  strokeType: StrokeType.optional().default('solid'),
  // TODO: 旧フィールド。strokeOpacity/fillOpacity未設定の既存データ（枠線・塗りの区別がない）読み込み時の
  // フォールバック用にのみ残す。新規保存時はstrokeOpacity/fillOpacityを使うこと
  opacity: z.number().min(0).max(1).optional(),
  strokeOpacity: z.number().min(0).max(1).optional(),
  // 半透明の図形を下地の文書とどう合成するか（未設定時は通常の重ね描きとして扱う。
  // defaultを付けると、直接オブジェクトリテラルを組み立てている既存の全箇所へ
  // このフィールドの明示が必須になってしまうため、あえて付けていない）
  blendMode: BlendMode.optional(),
  content: z.string().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  comment: z
    .object({
      chat: z.unknown().optional(), // TODO: チャットの形式は要検討
    })
    .default({}),
  // 重ね順。未設定の場合はcreatedAtを実効的な重ね順キーとして扱う（utils/document/annotationOrder.ts参照）
  zIndex: z.number().optional(),
  // 作成者。人間が作成した場合はAppSettings.userName（未登録ならundefined）、
  // プラグインが作成した場合はプラグイン名がservices/document/annotation.ts側で設定される
  author: z.string().optional(),
  // タグ。人間側からは現状設定不可（今後のUI対応まで見送り）。プラグインが冪等な再実行等に利用する
  tags: z.string().array().optional(),
});
export const BoxAnnotationStyle = AnnotationBase.extend({
  type: z.literal('box'),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  fillColor: ColorCode.optional(),
  fillOpacity: z.number().min(0).max(1).optional(),
});
export type BoxAnnotationStyle = z.infer<typeof BoxAnnotationStyle>;
export const LineAnnotationStyle = AnnotationBase.extend({
  type: z.literal('line'),
  points: z.array(z.number()).length(4),
});
export type LineAnnotationStyle = z.infer<typeof LineAnnotationStyle>;
export const CircleAnnotationStyle = AnnotationBase.extend({
  type: z.literal('circle'),
  // 後方互換のため維持する正円時の半径。radiusX/radiusY未設定時のフォールバック値として扱う
  radius: z.number().positive(),
  // 楕円化した場合の水平・垂直半径。省略時はradiusを使用する（正円）
  radiusX: z.number().positive().optional(),
  radiusY: z.number().positive().optional(),
  fillColor: ColorCode.optional(),
  fillOpacity: z.number().min(0).max(1).optional(),
});
export type CircleAnnotationStyle = z.infer<typeof CircleAnnotationStyle>;

/**
 * 矢印の矢じり形状
 *
 * PDF仕様（ISO 32000のLine/PolyLine注釈における`/LE`）のAcrobat線端形状に準拠した命名。
 * 'none': 矢じりなし（直線と同じ見た目）, 'triangle': 塗りつぶし三角形（ClosedArrow）,
 * 'open': 輪郭のみの矢じり（OpenArrow）, 'square': 塗りつぶし四角, 'circle': 塗りつぶし円,
 * 'diamond': 塗りつぶし菱形, 'butt': 線に垂直な短い棒（Butt）, 'slash': 斜めの短い棒（Slash）,
 * 'reverseOpen': 外向きの輪郭のみの矢じり（ROpenArrow）,
 * 'reverseTriangle': 外向きの塗りつぶし三角形（RClosedArrow）
 *
 * 既存の値（none/triangle/open）は保存済みの`.kcfg`・プリセットとの後方互換のため名称を変更しない
 */
export const ArrowHeadType = z.enum([
  'none',
  'triangle',
  'open',
  'square',
  'circle',
  'diamond',
  'butt',
  'slash',
  'reverseOpen',
  'reverseTriangle',
]);
export type ArrowHeadType = z.infer<typeof ArrowHeadType>;

export const ArrowAnnotationStyle = AnnotationBase.extend({
  type: z.literal('arrow'),
  // lineと同じく [x1, y1, x2, y2] で、x/yを起点とした相対座標
  points: z.array(z.number()).length(4),
  startHead: ArrowHeadType.default('none'),
  endHead: ArrowHeadType.default('triangle'),
  headSize: z.number().positive().optional().default(10),
});
export type ArrowAnnotationStyle = z.infer<typeof ArrowAnnotationStyle>;

export const PolylineAnnotationStyle = AnnotationBase.extend({
  type: z.literal('polyline'),
  // [x1,y1,x2,y2,...]で、x/y（先頭の頂点）を起点とした相対座標。折れ矢印はendHead/startHeadで表現する
  points: z
    .array(z.number())
    .min(4)
    .refine((pts) => pts.length % 2 === 0, {
      message: '座標配列の要素数は偶数である必要があります',
    }),
  startHead: ArrowHeadType.default('none'),
  endHead: ArrowHeadType.default('none'),
  headSize: z.number().positive().optional().default(10),
});
export type PolylineAnnotationStyle = z.infer<typeof PolylineAnnotationStyle>;

export const PolygonAnnotationStyle = AnnotationBase.extend({
  type: z.literal('polygon'),
  // [x1,y1,x2,y2,...]で3頂点以上必須。x/y（先頭の頂点）を起点とした相対座標
  points: z
    .array(z.number())
    .min(6)
    .refine((pts) => pts.length % 2 === 0, {
      message: '座標配列の要素数は偶数である必要があります',
    }),
  fillColor: ColorCode.optional(),
  fillOpacity: z.number().min(0).max(1).optional(),
});
export type PolygonAnnotationStyle = z.infer<typeof PolygonAnnotationStyle>;

export const TextAnnotationStyle = AnnotationBase.extend({
  type: z.literal('text'),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  text: z.string().default(''),
  fontFamily: z.string().default('sans-serif'),
  fontSize: z.number().positive().default(16),
  fontWeight: z.number().default(400),
  textColor: ColorCode,
  textAlign: z.enum(['left', 'center', 'right']).default('left'),
  // 背景色。未指定の場合は背景なし（透明）。枠線の色・太さはbaseのcolor/strokeWidthを流用する
  fillColor: ColorCode.optional(),
  fillOpacity: z.number().min(0).max(1).optional(),
});
export type TextAnnotationStyle = z.infer<typeof TextAnnotationStyle>;

/**
 * アノテーション本体の情報
 *
 * TODO: これは文書一般のアノテーションとして再編し、現行のStyle実装は`PdfAnnotationStyle`などに変更する
 */
export const AnnotationStyle = z.discriminatedUnion('type', [
  BoxAnnotationStyle,
  LineAnnotationStyle,
  CircleAnnotationStyle,
  ArrowAnnotationStyle,
  PolylineAnnotationStyle,
  PolygonAnnotationStyle,
  TextAnnotationStyle,
]);
export type AnnotationStyle = z.infer<typeof AnnotationStyle>;

/**
 * PDFページ内の1テキストアイテムの、左上原点バウンディングボックス付きの内容
 *
 * `doc.getPageTextBlocks`ホストAPIでJSON化される共有契約のため、他の共有モデルと同様に
 * ここでZodスキーマとして定義する（`src/repositories/document/pdf.ts`のローカルinterfaceから移設）
 */
export const TextItemBox = z.object({
  text: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type TextItemBox = z.infer<typeof TextItemBox>;

/**
 * PDF自体に埋め込まれたしおり（アウトライン）の1項目
 *
 * `level`は階層の深さ（先頭階層は0）。`pageNumber`は宛先を1始まりのページ番号として
 * 解決できた場合のみ設定され、外部URLへのリンク等で解決できない項目はundefinedになる
 */
export const PdfOutlineEntry = z.object({
  title: z.string(),
  level: z.number().int().nonnegative(),
  pageNumber: z.number().int().positive().optional(),
});
export type PdfOutlineEntry = z.infer<typeof PdfOutlineEntry>;
