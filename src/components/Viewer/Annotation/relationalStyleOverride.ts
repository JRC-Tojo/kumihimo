/**
 * 関係性の検証結果（OK/NG）に応じたアノテーション描画スタイルの上書き値を計算する
 */

import type { RelationalVerificationStyle } from 'src/models/relational/style';
import type { RelationalStatus } from 'src/stores/relationalStore';

export interface RelationalStyleOverride {
  stroke: string;
  strokeWidth: number;
  fill: string;
}

/**
 * `#rgb` / `#rrggbb` 形式の16進カラーコードを`rgba(...)`文字列に変換する
 *
 * Konvaのノードはfill/strokeそれぞれの個別のopacityを持たないため、
 * 塗りの不透明度はfillColor側にrgba合成して表現する
 */
function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  const parts =
    normalized.length === 3
      ? normalized.split('').map((c) => c + c)
      : [normalized.slice(0, 2), normalized.slice(2, 4), normalized.slice(4, 6)];
  const [r, g, b] = parts.map((c) => parseInt(c, 16) || 0);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
