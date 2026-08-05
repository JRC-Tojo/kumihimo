/**
 * PDFビューアのズーム倍率に関する定数・ヘルパー関数
 *
 * 高倍率になるほど間隔を広げた段階的なズームステップを提供する。
 * ズームイン/アウトボタンやCtrl+ホイール操作はこのステップ配列上を移動し、
 * 固定パーセンテージ刻みでの増減は行わない。
 */

export const MIN_ZOOM = 20;
export const MAX_ZOOM = 800;

export const ZOOM_STEPS = [20, 25, 33, 50, 67, 75, 100, 133, 167, 200, 300, 400, 600, 800];

/** ページ一覧モードでの拡大率上限（%）。サムネイル自体の生成解像度が低いため、
 * これ以上拡大しても画像がぼやけるだけで意味がない */
export const PAGE_LIST_MAX_ZOOM = 100;
/** ページ一覧モードへ切り替えた際に最初に表示される倍率（%） */
export const PAGE_LIST_INITIAL_ZOOM = 67;

/**
 * `DocumentViewer.vue`の`.pdf-viewer-container`に設定する余白（pt単位、上下左右）。
 * フィット計算（`useZoomControl`）が利用可能領域を求める際にも同じ値を使うことで、
 * CSSとJSの値がズレて片方だけ更新される事態を防ぐ。`.pdf-viewer-container`側は
 * CSSカスタムプロパティ経由でこの値を参照する
 */
export const PDF_VIEWER_CONTAINER_MARGIN_PT = 10;

/** ズーム倍率をMIN_ZOOM〜MAX_ZOOMの範囲に丸める */
export function clampZoom(level: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, level));
}

/** 現在の倍率より大きい直近のステップを返す（無ければMAX_ZOOM） */
export function nextZoomStep(current: number): number {
  return ZOOM_STEPS.find((step) => step > current) ?? MAX_ZOOM;
}

/** 現在の倍率より小さい直近のステップを返す（無ければMIN_ZOOM） */
export function prevZoomStep(current: number): number {
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    const step = ZOOM_STEPS[i];
    if (step !== undefined && step < current) return step;
  }
  return MIN_ZOOM;
}
