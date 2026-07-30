/**
 * 複数頂点（折れ線・ポリゴン）の各頂点に表示するアンカー（ドラッグハンドル）のKonva設定を生成する
 *
 * PolylineAnnotation.vue / PolygonAnnotation.vue で共有する純粋関数
 */

import type { AnnotationID, ColorCode } from 'src/models/document/pdf';

export interface PointAnchorConfig {
  id: string;
  annotationId: AnnotationID;
  x: number;
  y: number;
  width: number;
  height: number;
  offset: { x: number; y: number };
  name: string;
  fill: string;
  stroke: ColorCode;
  strokeWidth: number;
  cornerRadius: number;
  draggable: boolean;
  listening: boolean;
  cursor: string;
}

export function buildPointAnchorConfigs(
  points: readonly number[],
  color: ColorCode | undefined,
  annotationId: AnnotationID,
  isEditing: boolean,
  isSelected: boolean,
): PointAnchorConfig[] {
  const draggable = isEditing && isSelected;
  const configs: PointAnchorConfig[] = [];

  for (let i = 0; i + 1 < points.length; i += 2) {
    const index = i / 2;
    configs.push({
      id: `${annotationId}-anchor-${index}`,
      annotationId,
      x: points[i] ?? 0,
      y: points[i + 1] ?? 0,
      width: 10,
      height: 10,
      offset: { x: 5, y: 5 },
      name: 'annotation-anchor',
      fill: '#ffffff',
      // アンカーは注釈本体の色とは別の編集UIのため、線色が未設定（「色なし」）でも常に見えるようにする
      stroke: color ?? ('#000000' as ColorCode),
      strokeWidth: 2,
      cornerRadius: 0,
      draggable,
      listening: draggable,
      cursor: draggable ? 'grab' : 'default',
    });
  }

  return configs;
}
