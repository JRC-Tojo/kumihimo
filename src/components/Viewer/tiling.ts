/**
 * 巨大ページ×高倍率時のタイル分割レンダリングに関する定数・判定・グリッド計算ロジック
 *
 * ブラウザのcanvasには最大サイズ・最大面積の上限があり（ブラウザ・OSにより異なる）、
 * `pdfManager.ts`の`renderPage()`が使う`pixelWidth/pixelHeight = viewport.width/height × devicePixelRatio`は
 * その上限に対して無条件のままスケールする。大判ページ×高倍率×高DPRの組み合わせで上限を超えると、
 * pdf.js側で例外が発生する、あるいはcanvasが空白のまま描画されないといった破綻につながる。
 *
 * 通常サイズのページ・通常の倍率では`shouldUseTiling`は常にfalseを返し、既存の単一canvasの
 * レンダリング経路（`renderPage()`・`PdfPage.vue`の既存テンプレート）は一切変更しない。
 * 発火条件を満たす場合のみ、`PdfPage.vue`が本モジュールの計算結果をもとにタイル分割経路へ切り替える
 */

/** CSS px（devicePixelRatio適用前、scale適用前）でのページ寸法 */
export interface PageSizeCssPx {
  width: number;
  height: number;
}

/** 1タイルの一辺（device px）。ブラウザのcanvas面積上限に対して十分小さい正方形にしておく */
export const TILE_SIZE_DEVICE_PX = 1024;

/**
 * この面積（device px^2）を超えるページ×倍率×DPRの組み合わせでのみタイル分割を有効化する
 * （概ね4000×4000 device px相当。通常サイズのページ・通常倍率ではまず超えない）
 */
export const TILE_ACTIVATION_PIXEL_BUDGET = 16_000_000;

/** ページ全体を単一canvasでレンダリングした場合の面積（device px^2）を計算する */
function devicePixelArea(pageSizeCssPx: PageSizeCssPx, scale: number, dpr: number): number {
  const deviceWidth = pageSizeCssPx.width * scale * dpr;
  const deviceHeight = pageSizeCssPx.height * scale * dpr;
  return deviceWidth * deviceHeight;
}

/** 指定のページサイズ・倍率・DPRの組み合わせで、タイル分割レンダリングを使うべきかどうか */
export function shouldUseTiling(pageSizeCssPx: PageSizeCssPx, scale: number, dpr: number): boolean {
  return devicePixelArea(pageSizeCssPx, scale, dpr) > TILE_ACTIVATION_PIXEL_BUDGET;
}

/**
 * タイル分割を使う場合に、既存の全ページラスタ（`renderPage()`）をプレースホルダー・
 * まだタイルが描画されていない領域の背景として使うための、予算内に収まるようクランプした倍率を返す。
 *
 * 面積は倍率の2乗に比例するため、`sqrt(予算 / 実際の面積)`を元の倍率に掛けることで、
 * アスペクト比を保ったまま面積が予算ちょうどになる倍率を求められる
 */
export function clampScaleToPixelBudget(
  pageSizeCssPx: PageSizeCssPx,
  scale: number,
  dpr: number,
  pixelBudget: number = TILE_ACTIVATION_PIXEL_BUDGET,
): number {
  const requestedArea = devicePixelArea(pageSizeCssPx, scale, dpr);
  if (requestedArea <= pixelBudget) return scale;
  return scale * Math.sqrt(pixelBudget / requestedArea);
}

/** タイルグリッド中の1タイル。`x`/`y`/`width`/`height`はページ左上を原点とした、scale適用後のCSS px */
export interface TileDescriptor {
  col: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * ページ全体（scale適用後のCSS px）を`TILE_SIZE_DEVICE_PX`単位の格子へ分割し、タイル一覧を返す。
 * 右端・下端のタイルは端数分だけ小さくなる（切り上げ分割のため）
 */
export function computeTiles(
  pageSizeCssPx: PageSizeCssPx,
  scale: number,
  dpr: number,
): TileDescriptor[] {
  const tileSizeCssPx = TILE_SIZE_DEVICE_PX / dpr;
  const scaledWidth = pageSizeCssPx.width * scale;
  const scaledHeight = pageSizeCssPx.height * scale;
  const cols = Math.max(1, Math.ceil(scaledWidth / tileSizeCssPx));
  const rows = Math.max(1, Math.ceil(scaledHeight / tileSizeCssPx));

  const tiles: TileDescriptor[] = [];
  for (let row = 0; row < rows; row++) {
    const y = row * tileSizeCssPx;
    for (let col = 0; col < cols; col++) {
      const x = col * tileSizeCssPx;
      tiles.push({
        col,
        row,
        x,
        y,
        width: Math.min(tileSizeCssPx, scaledWidth - x),
        height: Math.min(tileSizeCssPx, scaledHeight - y),
      });
    }
  }
  return tiles;
}
