import z from 'zod';
import { ArrowHeadType, BlendMode } from './document/pdf';

/**
 * 文書ページに表示する各ツール
 */
export interface IDocTool {
  id: string;
  icon: string;
  label: string;
  noMenu?: boolean;
  isActive: () => boolean;
  isDisable?: () => boolean;
  onClicked: () => void | Promise<void>;
}

/**
 * ビューモード
 */
export type ViewMode = 'single' | 'spread' | 'continuousSingle' | 'continuousSpread' | 'pageList';

/**
 * タイル表示モード
 */
export type TileMode = 'none' | 'vertical' | 'horizontal' | 'grid';

/**
 * アノテーション描画設定
 */
export const AnnotationLineStyle = z.object({
  type: z.literal('line'),
  strokeColor: z.string().optional(), // 未設定は「線色なし」を表す
  strokeWidth: z.number(),
  strokeType: z.enum(['solid', 'dashed', 'dotted', 'dash-dot']),
  strokeOpacity: z.number(),
  blendMode: BlendMode.optional(),
});
export const AnnotationBoxStyle = z.object({
  type: z.literal('box'),
  strokeColor: z.string().optional(), // 未設定は「線色なし」を表す
  strokeWidth: z.number(),
  strokeType: z.enum(['solid', 'dashed', 'dotted', 'dash-dot']),
  strokeOpacity: z.number(),
  fillColor: z.string(),
  fillPattern: z.enum(['none', 'hatch', 'solid']),
  fillOpacity: z.number(),
  blendMode: BlendMode.optional(),
});
export const AnnotationCircleStyle = z.object({
  type: z.literal('circle'),
  strokeColor: z.string().optional(), // 未設定は「線色なし」を表す
  strokeWidth: z.number(),
  strokeType: z.enum(['solid', 'dashed', 'dotted', 'dash-dot']),
  strokeOpacity: z.number(),
  fillColor: z.string().optional(),
  fillPattern: z.enum(['none', 'hatch', 'solid']),
  fillOpacity: z.number(),
  blendMode: BlendMode.optional(),
});
export const AnnotationTextStyle = z.object({
  type: z.literal('text'),
  textColor: z.string(),
  fontWeight: z.number(),
  fontFamily: z.string(),
  fontSize: z.number(),
  textAlign: z.enum(['left', 'center', 'right']),
  strokeColor: z.string().optional(), // 未設定は「線色なし」を表す
  strokeWidth: z.number(),
  strokeType: z.enum(['solid', 'dashed', 'dotted', 'dash-dot']),
  strokeOpacity: z.number(),
  fillColor: z.string().optional(),
  fillPattern: z.enum(['none', 'hatch', 'solid']),
  fillOpacity: z.number(),
  blendMode: BlendMode.optional(),
});
export const AnnotationArrowStyle = z.object({
  type: z.literal('arrow'),
  strokeColor: z.string().optional(), // 未設定は「線色なし」を表す
  strokeWidth: z.number(),
  strokeType: z.enum(['solid', 'dashed', 'dotted', 'dash-dot']),
  strokeOpacity: z.number(),
  startHead: ArrowHeadType,
  endHead: ArrowHeadType,
  headSize: z.number(),
  blendMode: BlendMode.optional(),
});
export const AnnotationPolylineStyle = z.object({
  type: z.literal('polyline'),
  strokeColor: z.string().optional(), // 未設定は「線色なし」を表す
  strokeWidth: z.number(),
  strokeType: z.enum(['solid', 'dashed', 'dotted', 'dash-dot']),
  strokeOpacity: z.number(),
  startHead: ArrowHeadType,
  endHead: ArrowHeadType,
  headSize: z.number(),
  blendMode: BlendMode.optional(),
});
export const AnnotationPolygonStyle = z.object({
  type: z.literal('polygon'),
  strokeColor: z.string().optional(), // 未設定は「線色なし」を表す
  strokeWidth: z.number(),
  strokeType: z.enum(['solid', 'dashed', 'dotted', 'dash-dot']),
  strokeOpacity: z.number(),
  fillColor: z.string(),
  fillPattern: z.enum(['none', 'hatch', 'solid']),
  fillOpacity: z.number(),
  blendMode: BlendMode.optional(),
});
export const DrawingAnnotationStyle = z.discriminatedUnion('type', [
  AnnotationLineStyle,
  AnnotationBoxStyle,
  AnnotationCircleStyle,
  AnnotationTextStyle,
  AnnotationArrowStyle,
  AnnotationPolylineStyle,
  AnnotationPolygonStyle,
]);
export type DrawingAnnotationStyle = z.infer<typeof DrawingAnnotationStyle>;
export type DrawingAnnotationType = DrawingAnnotationStyle['type'];

/**
 * アノテーションプリセット
 */
export const AnnotationTool = z.object({
  id: z.string(),
  name: z.string(),
  style: DrawingAnnotationStyle,
});
export type AnnotationTool = z.infer<typeof AnnotationTool>;

/**
 * アノテーション関係性定義
 */
export interface AnnotationRelation {
  sourceAnnotationId: string;
  targetAnnotationId: string;
  relationType: 'equals' | 'references' | 'contains' | 'condition';
  condition?: string; // 数学的条件式など
}
