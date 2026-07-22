/**
 * アノテーションの`BlendMode`を、Konva（Canvas 2D）の`globalCompositeOperation`値へ変換するユーティリティ
 *
 * 標準的なブレンドモード名（'multiply'・'screen'等）はCanvas 2Dの合成モード名と共通のため
 * そのまま使えるが、'normal'（通常の重ね描き）だけはCanvas側に同名の値が無く、
 * 代わりに'source-over'を指定する必要がある
 */

import type { BlendMode } from 'src/models/document/pdf';

export function blendModeToComposite(blendMode: BlendMode | undefined): GlobalCompositeOperation {
  if (blendMode === undefined || blendMode === 'normal') return 'source-over';
  return blendMode;
}
