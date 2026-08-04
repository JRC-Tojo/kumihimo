/**
 * 複数頂点（折れ線・ポリゴン）の各頂点に表示するアンカー（ドラッグハンドル）のKonva設定を生成する
 *
 * PolylineAnnotation.vue / PolygonAnnotation.vue で共有する純粋関数
 */

import type { AnnotationID } from 'src/models/document/pdf';
import {
  TRANSFORMER_ANCHOR_CORNER_RADIUS,
  TRANSFORMER_ANCHOR_FILL,
  TRANSFORMER_ANCHOR_SIZE,
  TRANSFORMER_ANCHOR_STROKE,
  TRANSFORMER_ANCHOR_STROKE_WIDTH,
} from './anchorStyle';

export interface PointAnchorConfig {
  id: string;
  annotationId: AnnotationID;
  x: number;
  y: number;
  width: number;
  height: number;
  offset: { x: number; y: number };
  scaleX: number;
  scaleY: number;
  name: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  cornerRadius: number;
  draggable: boolean;
  listening: boolean;
  cursor: string;
}

export function buildPointAnchorConfigs(
  points: readonly number[],
  annotationId: AnnotationID,
  isEditing: boolean,
  isSelected: boolean,
  stageScale: number,
): PointAnchorConfig[] {
  const draggable = isEditing && isSelected;
  // ステージの拡大率と逆のscaleを乗せることで、頂点アンカーの見た目上のサイズをズームに
  // 関わらず一定に保つ（issue #49）。stageScaleが0以下になる異常値では逆数が発散するため1にフォールバックする
  const inverseScale = stageScale > 0 ? 1 / stageScale : 1;
  const configs: PointAnchorConfig[] = [];

  for (let i = 0; i + 1 < points.length; i += 2) {
    const index = i / 2;
    configs.push({
      id: `${annotationId}-anchor-${index}`,
      annotationId,
      x: points[i] ?? 0,
      y: points[i + 1] ?? 0,
      width: TRANSFORMER_ANCHOR_SIZE,
      height: TRANSFORMER_ANCHOR_SIZE,
      offset: { x: TRANSFORMER_ANCHOR_SIZE / 2, y: TRANSFORMER_ANCHOR_SIZE / 2 },
      scaleX: inverseScale,
      scaleY: inverseScale,
      name: 'annotation-anchor',
      // box/circle/textが使うKonva Transformerの頂点と見た目を揃える
      fill: TRANSFORMER_ANCHOR_FILL,
      stroke: TRANSFORMER_ANCHOR_STROKE,
      strokeWidth: TRANSFORMER_ANCHOR_STROKE_WIDTH,
      cornerRadius: TRANSFORMER_ANCHOR_CORNER_RADIUS,
      draggable,
      listening: draggable,
      cursor: draggable ? 'grab' : 'default',
    });
  }

  return configs;
}
