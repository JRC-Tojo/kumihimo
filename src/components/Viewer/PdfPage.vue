<template>
  <!-- outerはレイアウト上占有するスペース（実際のズーム倍率での見た目サイズ）を確保する。
       innerは最後に実際にラスタライズした解像度（lastRenderedScale）のサイズのまま、CSS transformで
       見た目上だけscaleへ引き伸ばす・縮める。Konvaはtransformを適用したDOM上の
       getBoundingClientRect比率からポインタ座標を自動補正するため、この二重構造でも
       アノテーションの当たり判定はズレない -->
  <div class="page-outer" :style="outerStyle">
    <div class="page-wrapper" :style="innerStyle">
      <canvas ref="canvasRef" class="pdf-canvas" />

      <!-- タイルレンダリング層: 巨大ページ×高倍率（tiling.tsのshouldUseTiling）でのみ有効化される。
           backdrop（上のcanvas）とKonvaアノテーション層の間の.page-wrapper子要素として配置する。
           以前はこれらの兄弟（.page-outer直下）としていたが、position: absolute + z-index: auto の
           要素はDOM順で後にあるものほど手前に描画されるCSSの積み重ね順のため、後発のタイル層が
           Konvaアノテーション層より手前に出てしまい、注釈が見えなくなる・マウス操作もタイル層に
           奪われて描画/選択ができなくなる不具合になっていた。.page-wrapper自体は既にcssZoomFactor分の
           transform: scaleが掛かっているため、このタイル層自身のtransformにはその分を打ち消した
           nestedTileLayerScaleを使う -->
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

      <!-- Konvaアノテーションレイヤー -->
      <AnnotationLayer
        v-if="canvasRendered"
        :file="props.file"
        :annotations="currentPageAnnotations"
        :scale="lastRenderedScale"
        v-model:selected-annot-ids="selectedAnnotIds"
        v-model:page="page"
        v-model:canvas-size="canvasSize"
        @register-annot="onRegisterAnnot"
        @register-annot-batch="onRegisterAnnotBatch"
        @duplicate-batch="onDuplicateBatch"
        @remove-annot="onRemoveAnnot"
      />

      <!-- Ctrl+F検索のマッチハイライト（issue #33）。常にpointer-events: noneのため、
           上記Konvaレイヤーの操作性には一切影響しない -->
      <SearchHighlightLayer
        v-if="canvasRendered && currentPageSearchMatches.length > 0"
        :matches="currentPageSearchMatches"
        :active-match-id="props.activeSearchMatchId"
        :scale="lastRenderedScale"
      />

      <!-- 選択可能なテキストレイヤー（issue #33）。テキスト選択ツール選択時のみ
           pointer-eventsを受け付け、それ以外は完全に透過してアノテーション操作を妨げない -->
      <TextLayer
        v-if="canvasRendered"
        :boxes="pageTextBlocks"
        :scale="lastRenderedScale"
        :interactive="isTextSelectMode"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import AnnotationLayer from './Annotation/AnnotationLayer.vue';
import TextLayer from './TextLayer.vue';
import SearchHighlightLayer from './SearchHighlightLayer.vue';
import { debounce, useQuasar } from 'quasar';
import type { AnnotationID, AnnotationStyle, TextItemBox } from 'src/models/document/pdf.js';
import type { TextSearchMatch } from 'src/models/document/search';
import type { ContainerElementFile } from 'src/models/container';
import type { PageSize } from './pdfManager';
import {
  clampScaleToPixelBudget,
  computeTiles,
  shouldUseTiling,
  type TileDescriptor,
} from './tiling';
import { cancelPendingRenderForCanvas, isRenderCancelledError } from './pdfManager';
import { useEditorStore } from 'src/stores/editorStore';

interface Props {
  file: ContainerElementFile;
  annotations: AnnotationStyle[];
  /** タイル分割の要否判定・グリッド計算に使う、スケール1でのページCSS px寸法 */
  pageSize1x: PageSize;
  onRender: (pageNumber: number, canvas: HTMLCanvasElement, scale: number) => Promise<PageSize>;
  onRenderTile: (
    pageNumber: number,
    canvas: HTMLCanvasElement,
    scale: number,
    tile: TileDescriptor,
    dpr: number,
  ) => Promise<void>;
  // 戻り値は登録が成功したかどうか（AnnotationLayer.vueのconfirmNewAnnotation参照）
  onRegisterAnnot: (annot: AnnotationStyle) => Promise<boolean>;
  onRegisterAnnotBatch: (annots: AnnotationStyle[]) => Promise<void>;
  onDuplicateBatch: (
    sources: AnnotationStyle[],
    offset: { dx: number; dy: number },
    page: number,
    isGroup: boolean,
  ) => Promise<AnnotationStyle[]>;
  onRemoveAnnot: (annotID: AnnotationID) => Promise<void>;
  /** 指定ページのテキストアイテム一覧を取得する（選択可能テキストレイヤー用、issue #33） */
  onGetPageTextBlocks: (pageNumber: number) => Promise<TextItemBox[]>;
  /** 文書全体の検索マッチ一覧（このコンポーネントは自身のページ番号でフィルタして使う） */
  searchMatches: TextSearchMatch[];
  /** 現在アクティブな検索マッチのDOM id */
  activeSearchMatchId?: string | undefined;
}
const props = defineProps<Props>();

const editorStore = useEditorStore();
/** テキスト選択ツールが選択されている間のみ、TextLayerがポインタ操作を受け付ける */
const isTextSelectMode = computed(() => editorStore.currentTools === 'text-select');
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
// あり続け、実際の鮮明な表示はタイル層（nestedTileLayerScale）が担う
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

// ============ テキストレイヤー・検索ハイライト（issue #33） ============

/** 現在ページのテキストアイテム一覧（TextLayer用）。ページ番号は変わるがスケールには依存しないため、
 * ページ切り替え時のみ取得し直す（ズームでは再取得しない） */
const pageTextBlocks = ref<TextItemBox[]>([]);
/** 現在ページに属する検索マッチのみ（他ページ分はSearchHighlightLayerへ渡さない） */
const currentPageSearchMatches = computed(() => {
  return props.searchMatches.filter((m) => m.pageNumber === page.value);
});

/** 現在ページのテキストアイテムを取得し直す。取得中にページが切り替わっていた場合は結果を捨てる */
async function refreshPageTextBlocks(): Promise<void> {
  const requestedPage = page.value;
  // 取得中は前ページ分のブロックを表示し続けないよう先に空にする（TextLayerが新ページのcanvas上に
  // 旧ページのテキスト選択範囲を透明のまま重ねて表示してしまうのを防ぐ）
  pageTextBlocks.value = [];
  const blocks = await props.onGetPageTextBlocks(requestedPage);
  if (requestedPage !== page.value) return;
  pageTextBlocks.value = blocks;
}

watch(page, () => void refreshPageTextBlocks());

// ============ タイル分割レンダリング（巨大ページ×高倍率のみ） ============
// 通常サイズのページ・通常倍率では`tilingActive`は常にfalseのままで、上のbackdrop
// （既存の単一canvas経路）だけがそのまま使われる。

/** タイル分割を実際に使うかどうか（`tiling.ts`の`shouldUseTiling`判定結果） */
const tilingActive = ref(false);
/** タイルグリッドの計算・各タイルの実際のレンダリングに使った基準スケール（クランプされない目標値） */
const tileGridScale = ref(1);
/** タイルグリッド計算時の`devicePixelRatio`。タイルのCSS px寸法はこの値を基準に決まっているため、
 * 描画時に`window.devicePixelRatio`を読み直さず、グリッドと対になるこの値をそのまま使う */
const tileGridDpr = ref(1);
const tiles = ref<TileDescriptor[]>([]);

// .tile-layerは.page-wrapperの子要素として配置されている（Konvaアノテーション層より必ず奥、
// backdropのcanvasより必ず手前になるようにするため）。.page-wrapper自体には既に
// cssZoomFactor（scale/lastRenderedScale）分のtransform: scale(...)が掛かっているため、
// タイル層が最終的に到達すべき実効倍率（scale/tileGridScale）にするには、親から二重に掛かる分
// （cssZoomFactor）を打ち消した比率（lastRenderedScale/tileGridScale）だけを自分のtransformに適用する
const nestedTileLayerScale = computed(() => lastRenderedScale.value / tileGridScale.value);
const tileLayerStyle = computed(() => {
  if (!tilingActive.value) return undefined;
  return {
    width: `${props.pageSize1x.width * tileGridScale.value}px`,
    height: `${props.pageSize1x.height * tileGridScale.value}px`,
    transform: `scale(${nestedTileLayerScale.value})`,
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
 * 新要素を監視する。
 *
 * Vueの関数型`:ref`は、対象のDOM要素が変わっていなくても再描画のたびに無条件で
 * 呼び直される仕様（`@vue/runtime-core`の`setRef`実装を確認済み。文字列ref/refオブジェクトとは
 * 異なり、関数refには「前回と同じ参照なら呼ばない」という最適化が無い）。そのため、
 * 先頭で「前回登録した要素と同じなら何もしない」を必ずガードする。これが無いと、
 * 何らかの理由で本コンポーネントが再描画されるたびに同じ要素へ`observe()`し直すことになり、
 * IntersectionObserverは登録のたびに現在の交差状態を通知するため、そのたびに
 * `visibleTileKeys.value`が新しいSetに差し替わって再描画を誘発し、際限なく繰り返される
 * 無限ループになっていた
 */
function setTileWrapperRef(key: string, el: HTMLElement | null) {
  const prevEl = tileWrapperElByKey.get(key);
  if (prevEl === el) return;
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
 * タイル描画の同時実行数を制限する簡易キュー。
 *
 * タイル化への切り替わり・大きなズーム直後など、多数のタイルが一斉に画面内へ入ると、
 * それぞれの`renderPageTile()`呼び出しが（クリップ先はタイル分の小さな範囲でも）ページ全体分の
 * オペレータ列を辿るコストを払うため、それが同時多発するとメインスレッド・pdf.js Worker双方が
 * 輻輳し、かえって表示全体が重くなる。同時に走らせる件数を絞り、残りは前の完了を待って
 * 順に処理することで、切り替わり直後の体感の重さを緩和する
 */
const MAX_CONCURRENT_TILE_RENDERS = 3;
let activeTileRenderCount = 0;
const pendingTileRenderStarts: (() => void)[] = [];
// タイルグリッドの世代。render()でグリッド（tiles/tileGridScale/tileGridDpr）を更新するたびに
// 加算する。キュー投入時点の世代と実行時点の世代が異なる場合、投入済みタスクは古いグリッドの
// tile（位置・サイズ）を参照しているため、実行せず破棄する（scheduleTileRender参照）
let tileGridGeneration = 0;
// アンマウント後もキューが動作し続け、破棄済みのcanvasへ向けたpdf.js描画が発行されるのを防ぐ
let unmounted = false;

function scheduleTileRender(task: () => Promise<void>): void {
  const generation = tileGridGeneration;
  const start = () => {
    // グリッドが更新済み、またはアンマウント済みなら実行せず破棄し、キューの次を進める
    if (generation !== tileGridGeneration || unmounted) {
      const skipped = pendingTileRenderStarts.shift();
      if (skipped) skipped();
      return;
    }
    activeTileRenderCount++;
    if (import.meta.env.DEV) {
      console.debug(
        `[tiling] タイル描画開始 (同時実行数=${activeTileRenderCount}, 待機中=${pendingTileRenderStarts.length})`,
      );
    }
    void task().finally(() => {
      activeTileRenderCount--;
      const next = pendingTileRenderStarts.shift();
      if (next) next();
    });
  };
  if (activeTileRenderCount < MAX_CONCURRENT_TILE_RENDERS) {
    start();
  } else {
    pendingTileRenderStarts.push(start);
  }
}

/**
 * 実際にタイルcanvasへレンダリングする（`pdfManager.ts`の`renderPageTile`を`onRenderTile`経由で呼ぶ）。
 * タイル単位の失敗はページ全体を巻き込まず、ログのみに留める。DEV環境では所要時間を
 * コンソールに出し、同時実行数の絞り込みが効いているか・どのタイルが重いかを確認できるようにする。
 * `gridScale`/`gridDpr`は呼び出し側（スケジュール時点）でキャプチャした値を受け取る。
 * 実行時点で`tileGridScale.value`を読み直すと、キュー待機中にグリッドが更新された場合、
 * このタスクが対象とする`tile`（旧グリッド）と新しいスケールが食い違ってしまう
 */
async function renderTile(
  tile: TileDescriptor,
  el: HTMLCanvasElement,
  gridScale: number,
  gridDpr: number,
) {
  const label = `[tiling] page=${page.value} tile=${tile.col}:${tile.row} @${gridScale.toFixed(2)}`;
  if (import.meta.env.DEV) console.time(label);
  try {
    await props.onRenderTile(page.value, el, gridScale, tile, gridDpr);
  } catch (error) {
    if (!isRenderCancelledError(error)) {
      console.error(
        `タイルのレンダリングに失敗しました (col=${tile.col}, row=${tile.row}):`,
        error,
      );
    }
  } finally {
    if (import.meta.env.DEV) console.timeEnd(label);
  }
}

/**
 * `setTileWrapperRef`と同じ理由（Vueの関数型`:ref`は要素が変わっていなくても再描画のたびに
 * 無条件で呼び直される）で、同じ要素に対する呼び出しは無視する。これが無いと、
 * 本コンポーネントが再描画されるたびに、既にマウント済みの全タイルcanvasへ
 * `renderPageTile`を呼び直すことになってしまう
 */
function onTileCanvasMounted(tile: TileDescriptor, el: HTMLCanvasElement | null) {
  const key = tileKeyOf(tile);
  const prevEl = tileCanvasEls.get(key);
  if (prevEl === el) return;
  if (el) {
    tileCanvasEls.set(key, el);
    const gridScale = tileGridScale.value;
    const gridDpr = tileGridDpr.value;
    scheduleTileRender(() => renderTile(tile, el, gridScale, gridDpr));
  } else {
    tileCanvasEls.delete(key);
  }
}

// タイルグリッドが再計算された（ズーム確定・ページ切り替え）際、既に画面内にあり
// マウント済みのタイルcanvasはv-forのkeyが安定している（col:row）ため要素自体は再利用される。
// 新しい基準スケールで明示的に再レンダリングし直さないと、古い倍率のまま表示され続けてしまう
watch(tiles, (newTiles) => {
  const gridScale = tileGridScale.value;
  const gridDpr = tileGridDpr.value;
  for (const tile of newTiles) {
    const el = tileCanvasEls.get(tileKeyOf(tile));
    if (el) scheduleTileRender(() => renderTile(tile, el, gridScale, gridDpr));
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
// backdropを最後に実際にレンダリングした時点のページ番号（下のbackdropAlreadyCurrent判定専用）。
// lastRenderedScaleだけでは、単一表示モードでページを切り替えても倍率が変わらない場合に
// 「描画済み」と誤判定してしまう（ページは変わったのにbackdropが古いページのままになる）ため、
// スケールに加えページ番号も一致しているかを合わせて見る
const lastRenderedPage = ref<number | undefined>(undefined);

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

  // クランプ後のbackdropScaleは予算に対して飽和するため、タイル分割中にズームを続けても
  // 変化しないことが多い。同じページ・同じbackdropScaleで既に描画済みなら、重いpage.render()の
  // 再実行を省略する（タイルグリッド自体は目標スケールの変化に応じて下で必ず更新する）
  const backdropAlreadyCurrent =
    canvasRendered.value &&
    lastRenderedPage.value === page.value &&
    backdropScale === lastRenderedScale.value;

  if (!backdropAlreadyCurrent) {
    const label = `[tiling] page=${page.value} backdrop@${backdropScale.toFixed(2)}`;
    if (import.meta.env.DEV) console.time(label);
    const result = await props.onRender(page.value, canvas.value, backdropScale);
    if (import.meta.env.DEV) console.timeEnd(label);
    if (generation !== renderGeneration) return;

    layoutSize.value = result;
    canvasSize.value = {
      width: canvas.value.width,
      height: canvas.value.height,
      scaleX: backdropScale,
      scaleY: backdropScale,
    };
    lastRenderedScale.value = backdropScale;
    lastRenderedPage.value = page.value;
  } else if (import.meta.env.DEV) {
    console.debug(
      `[tiling] page=${page.value} backdrop再描画をスキップ（scale=${backdropScale.toFixed(2)}のまま変化なし）`,
    );
  }

  // タイルグリッドの再計算は、この関数が呼ばれるタイミング（マウント時・ズームデバウンス確定後・
  // ページ切り替え時）でのみ行う。ズーム操作中のライブなscale変化だけではグリッド自体は再計算しない
  // （見た目の追従はnestedTileLayerScale側のCSS transformに任せる）
  tilingActive.value = useTiling;
  tileGridScale.value = targetRenderScale;
  tileGridDpr.value = dpr;
  tiles.value = useTiling ? computeTiles(props.pageSize1x, targetRenderScale, dpr) : [];
  // グリッドを更新した世代を進め、この時点でキュー待機中だったタイル描画タスク
  // （旧グリッドのtileを参照している）をscheduleTileRender側で破棄させる
  tileGridGeneration++;
}

/**
 * `render()`呼び出し失敗時の共通ハンドラ。`isRenderCancelledError`が真の場合
 * （`cancelPendingRenderForCanvas`による意図的なキャンセル、または同一canvasへの
 * 後続呼び出しによる置き換え）は正常な動作のため、エラー通知を出さず静かに無視する
 */
function notifyRenderFailure(error: unknown): void {
  if (isRenderCancelledError(error)) return;
  $q.notify({
    type: 'negative',
    message: `ページのレンダリングに失敗しました: ${error instanceof Error ? error.message : 'Unknown error'}`,
    position: 'top',
  });
}

onMounted(async () => {
  setupTileObserver();
  try {
    await render(scale.value);
    canvasRendered.value = true;
  } catch (error) {
    notifyRenderFailure(error);
  }
  void refreshPageTextBlocks();
});

onBeforeUnmount(() => {
  tileObserver?.disconnect();
  // アンマウント後もキューが動作し続け、破棄済みのcanvasへ向けたpdf.js描画が発行されるのを防ぐ。
  // まだ開始していないタイル描画も、キューに残ったままにせず取り除く
  unmounted = true;
  pendingTileRenderStarts.length = 0;
  // 既に開始済みの描画（backdrop・タイル）は上のフラグだけでは止まらないため、進行中の
  // RenderTaskを直接キャンセルし、破棄済みのPdfPageのために単一のpdf.js Workerが
  // 専有され続けないようにする
  if (canvas.value) cancelPendingRenderForCanvas(canvas.value);
  for (const tileEl of tileCanvasEls.values()) cancelPendingRenderForCanvas(tileEl);
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
  render(target).catch(notifyRenderFailure);
}, ZOOM_RERENDER_DEBOUNCE_MS);

watch(scale, () => debouncedRerenderForZoom());
watch(page, () => render(scale.value).catch(notifyRenderFailure));
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
