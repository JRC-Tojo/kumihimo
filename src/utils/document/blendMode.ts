/**
 * アノテーションの`BlendMode`を、Konva（Canvas 2D）の`globalCompositeOperation`値へ変換するユーティリティ
 *
 * 標準的なブレンドモード名（'multiply'・'screen'等）はCanvas 2Dの合成モード名と共通のため
 * そのまま使えるが、'normal'（通常の重ね描き）だけはCanvas側に同名の値が無く、
 * 代わりに'source-over'を指定する必要がある
 */

import type { BlendMode } from 'src/models/document/pdf';

/** 指定されたアノテーションの合成モードを、Canvas用のglobalCompositeOperation値へ変換する */
export function blendModeToComposite(blendMode: BlendMode | undefined): GlobalCompositeOperation {
  if (blendMode === undefined || blendMode === 'normal') return 'source-over';
  return blendMode;
}

/**
 * 指定されたアノテーションの合成モードを、PDF仕様（ISO 32000の`ExtGState`が持つ`/BM`）の
 * ブレンドモード名へ変換する。CSS/Canvas 2Dのケバブケース名（'color-dodge'等）に対し、
 * PDF側はパスカルケースの名前（'ColorDodge'等）を使う点のみ異なる
 */
export function blendModeToPdfBlendName(blendMode: BlendMode | undefined): string {
  if (blendMode === undefined || blendMode === 'normal') return 'Normal';
  return blendMode
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}
