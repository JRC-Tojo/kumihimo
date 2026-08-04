/**
 * Group系（line/arrow/polyline/polygon）が独自に描画する頂点アンカーの見た目を、
 * box/circle/textが使う共有のKonva Transformer（AnnotationLayer.vueのtransformerConfig）の
 * アンカーと統一するための定数
 *
 * transformerConfigはKonvaのTransformerデフォルト値を上書きしていないため、ここではその
 * デフォルト値（node_modules/konva/lib/shapes/Transformer.jsのFactory.addGetterSetter呼び出し）
 * をそのまま定数化する
 */
export const TRANSFORMER_ANCHOR_SIZE = 10;
export const TRANSFORMER_ANCHOR_FILL = 'white';
export const TRANSFORMER_ANCHOR_STROKE = 'rgb(0, 161, 255)';
export const TRANSFORMER_ANCHOR_STROKE_WIDTH = 1;
export const TRANSFORMER_ANCHOR_CORNER_RADIUS = 0;
