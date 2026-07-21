/**
 * 関係性の検証結果（OK/NG）に応じたアノテーション描画スタイルの上書き値を計算する
 */

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
