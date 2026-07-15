/**
 * アノテーション描画マネージャーサービス
 * アノテーション作成・編集イベントの管理
 */

import type { AnnotationStyle } from 'src/models/document/pdf';
import type { DrawingAnnotationStyle } from 'src/models/docPage';
import { ANNOTATION_GEOMETRY } from 'src/services/document/annotationGeometry';

/**
 * アノテーションの描画開始時に呼び出す
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
  // 'text'はdocPage.ts側のみに存在する未実装の描画種別のため、幾何レジストリには存在しない
  if (!(annotationStyle.type in ANNOTATION_GEOMETRY)) return null;

  return ANNOTATION_GEOMETRY[annotationStyle.type as AnnotationStyle['type']].createFromDrag(
    pageNumber,
    { x: startX, y: startY },
    { x: endX, y: endY },
    annotationStyle,
  );
}
