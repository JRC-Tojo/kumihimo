/**
 * z順に並んだアノテーション列を、Konva.Layer（`AnnotationBlendLayer`）の数を最小化する
 * ようグルーピングする純粋関数
 *
 * 1注釈1レイヤーだとKonvaのレイヤー数上限警告（推奨3〜5枚）に達しやすいため、以下の条件で
 * 複数の注釈を同一レイヤー（同一canvas）へまとめる:
 *
 * - 合成モードが'normal'（未設定含む）の注釈同士は、常に同一レイヤーへまとめてよい
 *   （背景と個別合成する必要が無く、同一canvasへの重ね描きでも結果が変わらないため）
 * - 合成モードが同一の非'normal'（'multiply'/'screen'等）の注釈同士は、互いの外接矩形が
 *   重なっていない場合に限り同一レイヤーへまとめる。重なっている場合、同一canvasに乗せると
 *   注釈同士が先に合成されてから背景と合成されてしまい、個別に背景と合成した場合と結果が
 *   変わってしまうため、そこで分割し1注釈1レイヤーにフォールバックする
 *
 * z順（配列の並び）は変えない。マージ条件を追加しただけで既存の条件を弱めていないため、
 * 常に元の実装と同じかそれ以下のレイヤー数になる（描画結果を変えない範囲でのみ削減する）
 */
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import { ANNOTATION_GEOMETRY } from './annotationGeometry';
import type { BoundingBox } from 'src/models/common';

export interface AnnotationBlendGroup {
  key: AnnotationID;
  blendMode: AnnotationStyle['blendMode'];
  annotations: AnnotationStyle[];
}

function isNormalBlend(blendMode: AnnotationStyle['blendMode']): boolean {
  return blendMode === undefined || blendMode === 'normal';
}

function boundingBoxOf(annotation: AnnotationStyle): BoundingBox {
  return ANNOTATION_GEOMETRY[annotation.type].boundingBox(annotation);
}

/** 2つの矩形が重なっているかどうか（境界が接するだけの場合は重なりなしとする） */
function boundingBoxesOverlap(a: BoundingBox, b: BoundingBox): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * 候補の注釈が、既存グループのいずれかの注釈と外接矩形で重なっているかどうか
 */
function overlapsAnyOf(candidate: AnnotationStyle, group: AnnotationStyle[]): boolean {
  const candidateBox = boundingBoxOf(candidate);
  return group.some((existing) => boundingBoxesOverlap(boundingBoxOf(existing), candidateBox));
}

export function groupAnnotationsByBlendMode(
  annotations: AnnotationStyle[],
): AnnotationBlendGroup[] {
  const groups: AnnotationBlendGroup[] = [];

  for (const annotation of annotations) {
    const last = groups.at(-1);
    const canMergeIntoLast =
      last !== undefined &&
      (isNormalBlend(last.blendMode)
        ? isNormalBlend(annotation.blendMode)
        : last.blendMode === annotation.blendMode && !overlapsAnyOf(annotation, last.annotations));

    if (last !== undefined && canMergeIntoLast) {
      last.annotations.push(annotation);
    } else {
      groups.push({
        key: annotation.id,
        blendMode: annotation.blendMode,
        annotations: [annotation],
      });
    }
  }

  return groups;
}
