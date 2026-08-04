/**
 * 相似変換をAnnotationStyleの幾何情報へ適用する
 *
 * 文書更新前後のページ画像から推定した相似変換（拡大縮小・回転・平行移動）を、
 * アノテーションの絶対座標（x/y起点）・相対座標（points）・スカラーサイズ
 * （width/height/radius）にそれぞれ適切な形で反映する。box/textアノテーションは
 * 回転を表現するフィールドを持たないため、原点の移動とスケールのみを反映し、
 * 回転自体は近似的に無視する（大きな回転が推定された場合はRANSACのインライア率が
 * 下がりやすく、その際は追跡失敗＝低信頼タグ付けとして扱われる想定）
 */

import type { AnnotationStyle } from 'src/models/document/pdf';
import type { Point } from 'src/components/Viewer/Annotation/annotationGeometry';
import { applyTransform, type SimilarityTransform } from './similarityTransform';

/** 回転・拡大縮小のみを適用する（原点からの相対ベクトル向け。平行移動は含まない） */
function applyLinearTransform(t: SimilarityTransform, v: Point): Point {
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  return {
    x: t.scale * (cos * v.x - sin * v.y),
    y: t.scale * (sin * v.x + cos * v.y),
  };
}

/** [x1,y1,x2,y2,...]形式の相対座標配列（x/yを起点とするオフセット）に回転・拡大縮小を適用する */
function transformOffsetPoints(points: number[], t: SimilarityTransform): number[] {
  const result: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    const transformed = applyLinearTransform(t, { x: points[i]!, y: points[i + 1]! });
    result.push(transformed.x, transformed.y);
  }
  return result;
}

/**
 * アノテーション1件に相似変換を適用した結果を返す（id・色・線種等の見た目情報は変更しない）
 */
export function transformAnnotationStyle(
  style: AnnotationStyle,
  t: SimilarityTransform,
): AnnotationStyle {
  const origin = applyTransform(t, { x: style.x, y: style.y });

  switch (style.type) {
    case 'box':
    case 'text':
      return {
        ...style,
        x: origin.x,
        y: origin.y,
        width: style.width * t.scale,
        height: style.height * t.scale,
      };
    case 'circle':
      return {
        ...style,
        x: origin.x,
        y: origin.y,
        radius: style.radius * t.scale,
        radiusX: style.radiusX !== undefined ? style.radiusX * t.scale : undefined,
        radiusY: style.radiusY !== undefined ? style.radiusY * t.scale : undefined,
      };
    case 'line':
    case 'arrow':
    case 'polyline':
    case 'polygon':
      return {
        ...style,
        x: origin.x,
        y: origin.y,
        points: transformOffsetPoints(style.points, t),
      };
    default: {
      const exhaustiveCheck: never = style;
      return exhaustiveCheck;
    }
  }
}
