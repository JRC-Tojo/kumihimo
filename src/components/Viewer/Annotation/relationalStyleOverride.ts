/**
 * 関係性の検証結果（OK/NG）に応じたアノテーション描画スタイルの上書き値を計算する
 */

import { ColorCode, type AnnotationStyle } from 'src/models/document/pdf';
import type { RelationalVerificationStyle } from 'src/models/relational/style';
import type { RelationalStatus } from 'src/stores/relationalStore';
import { hexToRgba } from 'src/utils/color/hexToRgba';

export interface RelationalStyleOverride {
  stroke: string;
  strokeWidth: number;
  fill: string;
}

/**
 * 検証状態に応じたスタイル上書き値を返す
 *
 * 検証保留中（pending）や関連なし（undefined）の場合は元のアノテーションスタイルを
 * そのまま使ってほしいのでundefinedを返す
 */
export function getRelationalStyleOverride(
  status: RelationalStatus,
  style: RelationalVerificationStyle,
): RelationalStyleOverride | undefined {
  if (status !== 'ok' && status !== 'ng') return undefined;

  const statusStyle = style[status];
  return {
    stroke: statusStyle.strokeColor,
    strokeWidth: statusStyle.strokeWidth,
    fill: hexToRgba(statusStyle.fillColor, statusStyle.fillOpacity),
  };
}

/**
 * 検証状態に応じたスタイル上書きを、アノテーション本体に適用した新しいオブジェクトを返す
 *
 * 画面描画（Konva）は`getRelationalStyleOverride`の返すrgba文字列をそのまま使えばよいが、
 * PDF書き出し（`pack*`/`embed*`系）はhexカラー＋不透明度の形でスタイルを受け取る前提のため、
 * こちらは`AnnotationStyle`と同じ形（色・線幅・塗り）で上書き後の値を返す。
 * 検証保留中（pending）や関連なし（undefined）の場合は元のannotationをそのまま返す
 */
export function applyRelationalOverrideToStyle(
  annotation: AnnotationStyle,
  status: RelationalStatus,
  style: RelationalVerificationStyle,
): AnnotationStyle {
  if (status !== 'ok' && status !== 'ng') return annotation;

  const statusStyle = style[status];
  const strokeColorParsed = ColorCode.safeParse(statusStyle.strokeColor);
  const fillColorParsed = ColorCode.safeParse(statusStyle.fillColor);
  const strokeOverride = {
    color: strokeColorParsed.success ? strokeColorParsed.data : annotation.color,
    strokeWidth: statusStyle.strokeWidth,
  };

  switch (annotation.type) {
    case 'box':
    case 'circle':
    case 'polygon':
    case 'text':
      return {
        ...annotation,
        ...strokeOverride,
        fillColor: fillColorParsed.success ? fillColorParsed.data : annotation.fillColor,
        fillOpacity: statusStyle.fillOpacity,
      };
    case 'line':
    case 'arrow':
    case 'polyline':
      return { ...annotation, ...strokeOverride };
  }
}
