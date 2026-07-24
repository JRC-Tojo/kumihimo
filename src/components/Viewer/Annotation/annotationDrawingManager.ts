/**
 * アノテーション描画マネージャーサービス
 * アノテーション作成・編集イベントの管理
 */

import type { AnnotationStyle } from 'src/models/document/pdf';
import type { DrawingAnnotationStyle } from 'src/models/docPage';
import {
  ANNOTATION_GEOMETRY,
  type Point,
} from 'src/components/Viewer/Annotation/annotationGeometry';

/**
 * アノテーションの描画開始時に呼び出す（ドラッグ方式の種別用）
 *
 * 終了時に呼び出すことで新規アノテーションオブジェクトを取得する関数を返す
 */
export function startDrawingAnnotation(
  pageNumber: number,
  startX: number,
  startY: number,
  annotationStyle: DrawingAnnotationStyle,
) {
  return (endX: number, endY: number) =>
    endDrawingAnnotation(pageNumber, startX, startY, endX, endY, annotationStyle);
}

function endDrawingAnnotation(
  pageNumber: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  annotationStyle: DrawingAnnotationStyle,
): AnnotationStyle | null {
  const module = ANNOTATION_GEOMETRY[annotationStyle.type];
  if (module.drawMode !== 'drag') return null;

  return module.createFromDrag(
    pageNumber,
    { x: startX, y: startY },
    { x: endX, y: endY },
    annotationStyle,
  );
}

/**
 * クリックで頂点を置いていく方式（折れ線・ポリゴン）で、確定時に呼び出す
 *
 * これまでに置いた頂点座標列からアノテーション実体を生成する
 */
export function createAnnotationFromPoints(
  pageNumber: number,
  points: Point[],
  annotationStyle: DrawingAnnotationStyle,
): AnnotationStyle | null {
  const module = ANNOTATION_GEOMETRY[annotationStyle.type];
  if (module.drawMode !== 'clickPoints') return null;

  return module.createFromPoints(pageNumber, points, annotationStyle);
}
