/**
 * ズームレベルの管理と、カーソル位置基準でのズーム・フィット機能をまとめたコンポーザブル
 *
 * `DocumentTabView.vue`が持つスクロールコンテナ（viewer）と、`DocumentViewer.vue`が公開する
 * 現在ページのDOM矩形（getAnchorRect）を用いて、拡大縮小前後でカーソル直下の文書上の位置を
 * 画面上の同じ位置に保つ。ズームイン/アウトボタン・Ctrl+ホイール・フィット（幅/ページ全体）を
 * すべてこの層にまとめることで、`DocumentTabView.vue`から純粋なズームロジックを分離する
 */

import { nextTick, ref, type Ref } from 'vue';
import {
  clampZoom,
  nextZoomStep,
  PDF_VIEWER_CONTAINER_MARGIN_PT,
  prevZoomStep,
} from 'src/components/Viewer/zoomSteps';
import type { PageSize } from 'src/components/Viewer/pdfManager';

/** ズームのアンカー計算に必要な最小限のインターフェース（`DocumentViewer.vue`のdefineExposeと対応） */
export interface ZoomAnchorSource {
  getAnchorRect: () => DOMRect | undefined;
}

export interface UseZoomControlDeps {
  /** 実際にスクロールするコンテナ（`DocumentTabView.vue`の`.document-viewer-wrapper`） */
  viewer: Ref<HTMLElement | null>;
  documentViewer: Ref<ZoomAnchorSource | null>;
  currentPage: Ref<number>;
  pageSizes: Ref<PageSize[]>;
}

// pt→px変換（96dpi基準）。.pdf-viewer-containerの上下左右マージン合計を、フィット計算での
// 利用可能領域から差し引くために使う
const PDF_VIEWER_CONTAINER_MARGIN_PX = 2 * PDF_VIEWER_CONTAINER_MARGIN_PT * (96 / 72);

export function useZoomControl(deps: UseZoomControlDeps) {
  const zoomLevel = ref(100);

  /**
   * ビューポート上の1点（未指定時は表示領域中央）を基準にズームレベルを変更する。
   * 基準点直下にある文書上の位置を、変更後もスクロール位置を補正して同じ画面位置に保つ
   * （連続表示モードで、左上基準のままズームすると表示中のページがズレる問題への対応）
   *
   * アンカーの基準には、スクロールコンテナ全体ではなく現在ページ自身のDOM矩形
   * （`DocumentViewer.vue`の`getAnchorRect`）を用いる。`.pages-container`/`.continuous-pages`は
   * `margin: auto`で水平方向に中央寄せされており、この余白はズーム倍率ごとに変わるうえ、
   * 連続表示モードではページ間に非スケール（固定px）のマージンも挟まるため、スクロールコンテナを
   * 単一のスケール係数で線形にモデル化できない。個々のページ矩形を前後で直接測定することで、
   * これらの非線形要素を計算に持ち込まずに済む
   */
  async function setZoomLevelAtPoint(level: number, clientX?: number, clientY?: number) {
    const clamped = clampZoom(level);
    const el = deps.viewer.value;
    if (clamped === zoomLevel.value || !el) {
      zoomLevel.value = clamped;
      return;
    }

    const rect = el.getBoundingClientRect();
    const x = clientX ?? rect.left + rect.width / 2;
    const y = clientY ?? rect.top + rect.height / 2;

    const anchorBefore = deps.documentViewer.value?.getAnchorRect();
    if (!anchorBefore) {
      zoomLevel.value = clamped;
      return;
    }

    const oldScale = zoomLevel.value / 100;
    const docX = (x - anchorBefore.left) / oldScale;
    const docY = (y - anchorBefore.top) / oldScale;

    zoomLevel.value = clamped;
    // レイアウトサイズ（pageSizeStyle等）が新しいscaleを反映するのを待つ
    await nextTick();

    const anchorAfter = deps.documentViewer.value?.getAnchorRect();
    if (!anchorAfter) return;

    const newScale = clamped / 100;
    el.scrollLeft += anchorAfter.left + docX * newScale - x;
    el.scrollTop += anchorAfter.top + docY * newScale - y;
  }

  /**
   * ズームレベルを設定
   */
  const setZoomLevel = (level: number): void => {
    void setZoomLevelAtPoint(level);
  };

  /**
   * ズームイン（非線形なズームステップ上を1段階進める）
   */
  const zoomIn = (clientX?: number, clientY?: number): void => {
    void setZoomLevelAtPoint(nextZoomStep(zoomLevel.value), clientX, clientY);
  };

  /**
   * ズームアウト（非線形なズームステップ上を1段階戻す）
   */
  const zoomOut = (clientX?: number, clientY?: number): void => {
    void setZoomLevelAtPoint(prevZoomStep(zoomLevel.value), clientX, clientY);
  };

  /**
   * 現在ページの幅がビューア表示領域の幅に収まるようズームレベルを設定する
   */
  function fitToWidth(): void {
    const el = deps.viewer.value;
    const size = deps.pageSizes.value[deps.currentPage.value - 1];
    if (!el || !size || size.width === 0) return;
    const availableWidth = el.clientWidth - PDF_VIEWER_CONTAINER_MARGIN_PX;
    setZoomLevel(Math.round((availableWidth / size.width) * 100));
  }

  /**
   * 現在ページ全体がビューア表示領域に収まるようズームレベルを設定する
   */
  function fitToPage(): void {
    const el = deps.viewer.value;
    const size = deps.pageSizes.value[deps.currentPage.value - 1];
    if (!el || !size || size.width === 0 || size.height === 0) return;
    const availableWidth = el.clientWidth - PDF_VIEWER_CONTAINER_MARGIN_PX;
    const availableHeight = el.clientHeight - PDF_VIEWER_CONTAINER_MARGIN_PX;
    const widthRatio = availableWidth / size.width;
    const heightRatio = availableHeight / size.height;
    setZoomLevel(Math.round(Math.min(widthRatio, heightRatio) * 100));
  }

  return {
    zoomLevel,
    setZoomLevel,
    zoomIn,
    zoomOut,
    fitToWidth,
    fitToPage,
  };
}
