/**
 * 線種（`StrokeType`）を、小さなSVGプレビュー用のdasharray文字列に変換するユーティリティ
 *
 * `strokeDash.ts`（Konva描画用、実際のstrokeWidthでスケールする数値配列）とは別に、
 * プリセットプレビュー（AnnotationPresetPreview.vue）やスタイルパネルの線種ボタン
 * （StrokeTypePreview.vue）など、固定サイズの小さなアイコン向けに簡易的な近似値を返す。
 *
 * 'double'（二重線）はSVGがネイティブでは二重線描画をサポートしないため、
 * 実キャンバス描画とは異なる専用のダッシュパターンで視覚的に区別する（既知の近似）
 */

import type { StrokeType } from 'src/models/document/pdf';

export function strokeTypeToPreviewDash(strokeType: StrokeType | undefined): string | undefined {
  switch (strokeType) {
    case 'dashed':
      return '3,2';
    case 'dotted':
      return '1,1.6';
    case 'dash-dot':
      return '3.5,1,1,1';
    case 'double':
      return '5,1';
    default:
      return undefined;
  }
}
