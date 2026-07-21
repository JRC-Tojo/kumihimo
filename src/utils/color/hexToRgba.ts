/**
 * `#rgb` / `#rrggbb` 形式の16進カラーコードを`rgba(...)`文字列に変換する
 *
 * Konva等の描画先ノードはfill/strokeそれぞれ個別のopacityを持たないため、
 * 各不透明度を反映したい場合は色側にrgba合成して表現する
 */
export function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  const parts =
    normalized.length === 3
      ? normalized.split('').map((c) => c + c)
      : [normalized.slice(0, 2), normalized.slice(2, 4), normalized.slice(4, 6)];
  const [r, g, b] = parts.map((c) => parseInt(c, 16) || 0);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
