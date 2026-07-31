<template>
  <!-- outerはレイアウト上占有するスペース（実際のズーム倍率での見た目サイズ）を確保する。
       innerは最後に実際にラスタライズした解像度（lastRenderedScale）のサイズのまま、CSS transformで
       見た目上だけscaleへ引き伸ばす・縮める。Konvaはtransformを適用したDOM上の
       getBoundingClientRect比率からポインタ座標を自動補正するため、この二重構造でも
       アノテーションの当たり判定はズレない -->
  <div class="page-outer" :style="outerStyle">
    <div class="page-wrapper" :style="innerStyle">
      <canvas ref="canvasRef" class="pdf-canvas" />
      <!-- Konvaアノテーションレイヤー -->
      <AnnotationLayer
        v-if="canvasRendered"
        :annotations="currentPageAnnotations"
        :scale="lastRenderedScale"
        v-model:selected-annot-ids="selectedAnnotIds"
        v-model:page="page"
        v-model:canvas-size="canvasSize"
        @register-annot="onRegisterAnnot"
        @remove-annot="onRemoveAnnot"
      />
    </div>

    <!-- タイルレンダリング層: 巨大ページ×高倍率（tiling.tsのshouldUseTiling）でのみ有効化される。
         .page-wrapper（バックドロップ）とは別基準（tileGridScale）でCSS拡大縮小するため、
         .page-outer直下の兄弟レイヤーとして独立させている -->
    <div v-if="tilingActive" class="tile-layer" :style="tileLayerStyle">
      <div
        v-for="tile in tiles"
        :key="tileKeyOf(tile)"
        class="tile-slot"
        :style="tileSlotStyle(tile)"
        :ref="(el) => setTileWrapperRef(tileKeyOf(tile), el as HTMLElement | null)"
      >
        <canvas
          v-if="shouldRenderTile(tile)"
          :ref="(el) => onTileCanvasMounted(tile, el as HTMLCanvasElement | null)"
          class="pdf-canvas tile-canvas"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import AnnotationLayer from './Annotation/AnnotationLayer.vue';
import { debounce, useQuasar } from 'quasar';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf.js';
import type { PageSize } from './pdfManager';
import {
  clampScaleToPixelBudget,
  computeTiles,
  shouldUseTiling,
  type TileDescriptor,
} from './tiling';

interface Props {
  annotations: AnnotationStyle[];
  /** タイル分割の要否判定・グリッド計算に使う、スケール1でのページCSS px寸法 */
  pageSize1x: PageSize;
  onRender: (pageNumber: number, canvas: HTMLCanvasElement, scale: number) => Promise<PageSize>;
  onRenderTile: (
    pageNumber: number,
    canvas: HTMLCanvasElement,
    scale: number,
    tile: TileDescriptor,
  ) => Promise<void>;
  onRegisterAnnot: (annot: AnnotationStyle) => Promise<void>;
  onRemoveAnnot: (annotID: AnnotationID) => Promise<void>;
}
const props = defineProps<Props>();
const page = defineModel<number>('page', { required: true });
const scale = defineModel<number>('scale', { required: true });
const selectedAnnotIds = defineModel<AnnotationID[]>('selectedAnnotIds', { required: true });

const $q = useQuasar();

const canvas = useTemplateRef('canvasRef');
const canvasRendered = ref(false);
const canvasSize = ref({ width: 0, height: 0, scaleX: 1, scaleY: 1 });
// 実際にラスタライズしたレイアウトサイズ（CSS px、devicePixelRatio適用前、lastRenderedScale基準）
const layoutSize = ref<PageSize>({ width: 0, height: 0 });
// 最後に実際にラスタライズしたスケール（backdrop用）。ズーム中はこれと`scale`の比率をCSS transformで
// 埋める。タイル分割が有効な場合はピクセル予算内にクランプされた値になり、要求された`scale`とは
// 一致しなくなる（鮮明な表示自体は別基準のタイル層が担うため、backdropは低解像度のままでよい）
const lastRenderedScale = ref(1);

/**
 * ズーム操作が止まってから実際に再ラスタライズするまでの待ち時間（ミリ秒）。
 * ズーム中の見た目はCSS transformのみで追従させ、操作が落ち着いた時点で
 * その時点のスケールに合わせて描き直すことで、鮮明さとメモリ・描画コストを両立する
 */
const ZOOM_RERENDER_DEBOUNCE_MS = 200;

// ラスタライズ済みの内容を、CSS transformで現在のズーム倍率まで拡大・縮小する係数。
// lastRenderedScaleとscaleが乖離するほど画質は劣化する（乖離が大きいほど、CSSでの拡大時はぼやけ、
// 縮小時は細い線がつぶれて薄く見える）ため、下のdebounce再描画で乖離を都度解消する。
// タイル分割が有効な場合、backdrop（このcssZoomFactor）は常にクランプされた低解像度のプレースホルダーで
// あり続け、実際の鮮明な表示はタイル層（tileCssZoomFactor）が担う
const cssZoomFactor = computed(() => scale.value / lastRenderedScale.value);

const outerStyle = computed(() => {
  if (layoutSize.value.width === 0) return undefined;
  return {
    width: `${layoutSize.value.width * cssZoomFactor.value}px`,
    height: `${layoutSize.value.height * cssZoomFactor.value}px`,
  };
});
const innerStyle = computed(() => {
  if (layoutSize.value.width === 0) return undefined;
  return {
    width: `${layoutSize.value.width}px`,
    height: `${layoutSize.value.height}px`,
    transform: `scale(${cssZoomFactor.value})`,
    transformOrigin: 'top left',
  };
});

const currentPageAnnotations = computed(() => {
  return props.annotations.filter((a) => a.pageNumber === page.value);
});

// ============ タイル分割レンダリング（巨大ページ×高倍率のみ） ============
// 通常サイズのページ・通常倍率では`tilingActive`は常にfalseのままで、上のbackdrop
// （既存の単一canvas経路）だけがそのまま使われる。

/** タイル分割を実際に使うかどうか（`tiling.ts`の`shouldUseTiling`判定結果） */
const tilingActive = ref(false);
/** タイルグリッドの計算・各タイルの実際のレンダリングに使った基準スケール（クランプされない目標値） */
const tileGridScale = ref(1);
const tiles = ref<TileDescriptor[]>([]);

const tileCssZoomFactor = computed(() => scale.value / tileGridScale.value);
const tileLayerStyle = computed(() => {
  if (!tilingActive.value) return undefined;
  return {
    width: `${props.pageSize1x.width * tileGridScale.value}px`,
    height: `${props.pageSize1x.height * tileGridScale.value}px`,
    transform: `scale(${tileCssZoomFactor.value})`,
    transformOrigin: 'top left',
  };
});

function tileKeyOf(tile: TileDescriptor): string {
  return `${tile.col}:${tile.row}`;
}
function tileSlotStyle(tile: TileDescriptor) {
  return {
    left: `${tile.x}px`,
    top: `${tile.y}px`,
    width: `${tile.width}px`,
    height: `${tile.height}px`,
  };
}

// タイルごとの実際のcanvas要素（グリッド再計算後も、同一col:rowのタイルスロットはv-forのkeyにより
// DOM要素が再利用されるため、明示的に再レンダリングをかけるために保持する）
const tileCanvasEls = new Map<string, HTMLCanvasElement>();
// 画面内に交差しているタイルのキー集合。DocumentViewer.vueのページ仮想化と同じ考え方で、
// 巨大ページを高倍率表示した際に画面外のタイルまで無駄にレンダリングしないようにする
const visibleTileKeys = ref(new Set<string>());
const tileWrapperElByKey = new Map<string, HTMLElement>();
const tileWrapperElToKey = new Map<HTMLElement, string>();
let tileObserver: IntersectionObserver | undefined;

function shouldRenderTile(tile: TileDescriptor): boolean {
  return visibleTileKeys.value.has(tileKeyOf(tile));
}

/**
 * タイルスロット（タイルcanvasの親div）のref登録・解除。
 * `DocumentViewer.vue`の`setWrapperRef`と同じ考え方: 旧要素があれば監視解除してから
 * 新要素を監視する
 */
function setTileWrapperRef(key: string, el: HTMLElement | null) {
  const prevEl = tileWrapperElByKey.get(key);
  if (prevEl) {
    tileObserver?.unobserve(prevEl);
    tileWrapperElToKey.delete(prevEl);
    tileWrapperElByKey.delete(key);
  }
  if (el) {
    tileWrapperElByKey.set(key, el);
    tileWrapperElToKey.set(el, key);
    tileObserver?.observe(el);
  } else {
    visibleTileKeys.value.delete(key);
  }
}

/**
 * 実際にタイルcanvasへレンダリングする（`pdfManager.ts`の`renderPageTile`を`onRenderTile`経由で呼ぶ）。
 * タイル単位の失敗はページ全体を巻き込まず、ログのみに留める
 */
async function renderTile(tile: TileDescriptor, el: HTMLCanvasElement) {
  try {
    await props.onRenderTile(page.value, el, tileGridScale.value, tile);
  } catch (error) {
    console.error(`タイルのレンダリングに失敗しました (col=${tile.col}, row=${tile.row}):`, error);
  }
}

function onTileCanvasMounted(tile: TileDescriptor, el: HTMLCanvasElement | null) {
  const key = tileKeyOf(tile);
  if (el) {
    tileCanvasEls.set(key, el);
    void renderTile(tile, el);
  } else {
    tileCanvasEls.delete(key);
  }
}

// タイルグリッドが再計算された（ズーム確定・ページ切り替え）際、既に画面内にあり
// マウント済みのタイルcanvasはv-forのkeyが安定している（col:row）ため要素自体は再利用される。
// 新しい基準スケールで明示的に再レンダリングし直さないと、古い倍率のまま表示され続けてしまう
watch(tiles, (newTiles) => {
  for (const tile of newTiles) {
    const el = tileCanvasEls.get(tileKeyOf(tile));
    if (el) void renderTile(tile, el);
  }
});

/**
 * タイルの交差観測を開始する。`root: null`（＝ブラウザビューポート）にする理由は
 * `DocumentViewer.vue`のページ仮想化と同様: 実際にスクロールする祖先要素の外側からでも
 * 正しく交差判定させるため
 */
function setupTileObserver() {
  const observer = new IntersectionObserver(
    (entries) => {
      const next = new Set(visibleTileKeys.value);
      for (const entry of entries) {
        const key = tileWrapperElToKey.get(entry.target as HTMLElement);
        if (key === undefined) continue;
        if (entry.isIntersecting) next.add(key);
        else next.delete(key);
      }
      visibleTileKeys.value = next;
    },
    { root: null, rootMargin: '200px' },
  );
  tileObserver = observer;
}

// ============ レンダリング本体 ============

// 同じPdfPageインスタンスに対してrender()が重ねて呼ばれた場合（ズームのデバウンス再描画と
// ページ切り替えの再描画が競合するケース等）、先に呼んだ（古い）render()の完了が後から呼んだ
// （新しい）render()より遅れることがある。世代番号を使い、自分より新しいrender()呼び出しが
// 既に発行されていれば、古い結果でreactive state（layoutSize等）を上書きしないようにする
let renderGeneration = 0;

async function render(targetRenderScale: number) {
  if (canvas.value === null) return;
  const generation = ++renderGeneration;

  const dpr = window.devicePixelRatio || 1;
  const useTiling = shouldUseTiling(props.pageSize1x, targetRenderScale, dpr);
  // タイル分割時、backdrop自体は目標スケールそのままではブラウザのcanvas面積上限を超え得るため、
  // 予算内に収まる解像度までクランプする。鮮明な表示自体はタイル層が担うため、backdropは
  // 「タイルがまだ描画されていない領域のCSS拡大プレースホルダー」としてのみ機能すればよい
  const backdropScale = useTiling
    ? clampScaleToPixelBudget(props.pageSize1x, targetRenderScale, dpr)
    : targetRenderScale;

  const result = await props.onRender(page.value, canvas.value, backdropScale);
  if (generation !== renderGeneration) return;

  layoutSize.value = result;
  canvasSize.value = {
    width: canvas.value.width,
    height: canvas.value.height,
    scaleX: backdropScale,
    scaleY: backdropScale,
  };
  lastRenderedScale.value = backdropScale;

  // タイルグリッドの再計算は、この関数が呼ばれるタイミング（マウント時・ズームデバウンス確定後・
  // ページ切り替え時）でのみ行う。ズーム操作中のライブなscale変化だけではグリッド自体は再計算しない
  // （見た目の追従はtileCssZoomFactor側のCSS transformに任せる）
  tilingActive.value = useTiling;
  tileGridScale.value = targetRenderScale;
  tiles.value = useTiling ? computeTiles(props.pageSize1x, targetRenderScale, dpr) : [];
}

onMounted(async () => {
  setupTileObserver();
  try {
    await render(scale.value);
    canvasRendered.value = true;
  } catch (error) {
    $q.notify({
      type: 'negative',
      message: `ページのレンダリングに失敗しました: ${error instanceof Error ? error.message : 'Unknown error'}`,
      position: 'top',
    });
  }
});

onBeforeUnmount(() => {
  tileObserver?.disconnect();
});

/**
 * ズーム操作が落ち着いた時点で、その時点のスケール（上限まで）に合わせて再ラスタライズする。
 * ドラッグ・ホイール中の連続したスケール変化のたびに走らせるとメモリ・描画コストが甚大なため、
 * 一定時間操作が無かった場合にのみ発火させる（既にその解像度で描画済みなら何もしない）
 */
const debouncedRerenderForZoom = debounce(() => {
  const target = scale.value;
  // tileGridScaleは（タイル分割の有無によらず）render()のたびに必ず目標スケールへ更新されるため、
  // これだけで「既にこの倍率で描画済みか」を判定できる（lastRenderedScaleはタイル分割時クランプされ
  // 目標スケールと一致しなくなるため、単独では判定に使えない）
  if (target === tileGridScale.value) return;
  void render(target);
}, ZOOM_RERENDER_DEBOUNCE_MS);

watch(scale, () => debouncedRerenderForZoom());
watch(page, () => void render(scale.value));
</script>

<style lang="scss" scoped>
.pdf-canvas {
  display: block;
  background: white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  image-rendering: pixelated;
}

.page-outer {
  position: relative;
  // 端数の丸め誤差でtransform後のサイズがわずかに外周をはみ出す場合に備えてクリップする
  overflow: hidden;
}

.page-wrapper {
  position: relative;
}

.tile-layer {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: top left;
}

.tile-slot {
  position: absolute;
  overflow: hidden;
}

.tile-canvas {
  width: 100%;
  height: 100%;
  display: block;
  image-rendering: pixelated;
}
</style>
