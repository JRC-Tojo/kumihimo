/**
 * 線種（`StrokeType`）をKonvaの`dash`設定値に変換するユーティリティ
 */

import type { StrokeType } from 'src/models/document/pdf';

/** 線幅1px相当を基準としたdashパターン（strokeWidthに応じてスケールする） */
const DASH_PATTERNS: Record<Exclude<StrokeType, 'solid'>, number[]> = {
  dashed: [4, 3],
  dotted: [1, 2],
  'dash-dot': [4, 2, 1, 2],
};

/**
 * 線種と線幅からKonvaの`dash`設定値を計算する
 * @returns 'solid'の場合はundefined（実線として描画される）
 */
export function strokeTypeToDash(
  strokeType: StrokeType | undefined,
  strokeWidth: number,
): number[] | undefined {
  if (strokeType === undefined || strokeType === 'solid') {
    return undefined;
  }

  const width = strokeWidth > 0 ? strokeWidth : 1;
  return DASH_PATTERNS[strokeType].map((unit) => unit * width);
}
