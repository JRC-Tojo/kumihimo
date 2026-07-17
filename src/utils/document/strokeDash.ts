/**
 * 線種（`StrokeType`）をKonvaの`dash`設定値に変換するユーティリティ
 *
 * 'double'（二重線）はKonva/SVGがネイティブでは二重線描画をサポートしないため、
 * 実際のキャンバス描画では'solid'と同等（dash未指定）に扱う既知の制限とする
 * （プリセットのプレビューアイコンのみ、2本の平行線として近似表示する）
 */

import type { StrokeType } from 'src/models/document/pdf';

/** 線幅1px相当を基準としたdashパターン（strokeWidthに応じてスケールする） */
const DASH_PATTERNS: Record<Exclude<StrokeType, 'solid' | 'double'>, number[]> = {
  dashed: [4, 3],
  dotted: [1, 2],
  'dash-dot': [4, 2, 1, 2],
};

/**
 * 線種と線幅からKonvaの`dash`設定値を計算する
 * @returns 'solid'・'double'の場合はundefined（実線として描画される）
 */
export function strokeTypeToDash(
  strokeType: StrokeType | undefined,
  strokeWidth: number,
): number[] | undefined {
  if (strokeType === undefined || strokeType === 'solid' || strokeType === 'double') {
    return undefined;
  }

  const width = strokeWidth > 0 ? strokeWidth : 1;
  return DASH_PATTERNS[strokeType].map((unit) => unit * width);
}
