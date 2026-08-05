<template>
  <div
    ref="gridRef"
    class="page-list-grid"
    :style="{ gridTemplateColumns: `repeat(${columns}, 1fr)` }"
  >
    <!-- ウィンドウより前の行の高さを確保するスペーサー。grid-column: 1/-1で行全体を占有し、
         実描画セルを次の行から開始させる -->
    <div ref="topSentinel" class="page-list-spacer" :style="{ height: `${topSpacerHeight}px` }" />

    <button
      v-for="idx in renderedIndices"
      :key="idx"
      type="button"
      :class="['page-list-cell', { active: idx + 1 === currentPage }]"
      :style="{ height: `${effectiveCellHeight}px` }"
      @click="emit('select-page', idx + 1)"
    >
      <img
        v-if="thumbnails.has(idx)"
        :src="thumbnails.get(idx)"
        :alt="$t('pdfEditor.pageList.thumbnailAlt', { page: idx + 1 })"
      />
      <q-spinner v-else color="primary" class="q-pa-md" />
      <div class="page-number">{{ idx + 1 }}</div>
    </button>

    <!-- ウィンドウより後の行の高さを確保するスペーサー -->
    <div
      ref="bottomSentinel"
      class="page-list-spacer"
      :style="{ height: `${bottomSpacerHeight}px` }"
    />
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  useTemplateRef,
  watch,
} from 'vue';

type GenerateThumbnailFunc = (pageNumber: number, maxWidth: number) => Promise<string>;

interface Prop {
  pageCount: number;
  currentPage: number;
  /** フッターのズームレベル（`zoomLevel / 100`）。1画面に表示できるページ数を拡大縮小で
   * 増減できるよう、セルサイズをこの倍率に連動させる */
  scale: number;
  onGenerateThumbnail: GenerateThumbnailFunc;
}
const prop = defineProps<Prop>();

const emit = defineEmits<{ 'select-page': [page: number] }>();

/** サムネイル生成時の最大横幅（px） */
const THUMBNAIL_MAX_WIDTH = 200;
/** サムネイル生成の同時実行数上限。高速スクロール時に大量のcanvas描画が同時発生しないようにする */
const MAX_CONCURRENT_GENERATION = 4;
/** ズーム100%時のセル最小幅（px）。旧`minmax(180px, 1fr)`と同じ値 */
const BASE_MIN_CELL_WIDTH = 180;
/** グリッドの行間・列間（px、1remに相当） */
const GRID_GAP = 16;
/** ズーム100%時のセルの高さ（px）。実際のページ縦横比によらず固定することで、ページ数が
 * 多い文書でもDOM上に実マウントする行数を一定に抑える仮想化（スペーサーによる行送り）の
 * 計算を簡単にする */
const BASE_CELL_HEIGHT = 260;
/** 同時にDOMへ実マウントする最大行数。ビューポートに収まる行数＋前後の余白として十分な値 */
const ROWS_PER_WINDOW = 10;
/** 上下端のスペーサーがビューポート付近に近づいた際、ウィンドウをずらす行数 */
const ROWS_MARGIN = 3;

// ==================== 列数・行数の計算 ====================

const gridRef = useTemplateRef('gridRef');
// グリッドコンテナの実幅（ResizeObserverで追従）。列数はこれとscaleの両方に依存するため、
// 生の幅をrefとして持ち、列数自体は算出式（computed）にする
const containerWidth = ref(0);
let resizeObserver: ResizeObserver | undefined;

// ズームレベルに応じたセルサイズ。フッターの拡大縮小操作で1画面に収まるページ数を
// 増減できるようにする（等倍からの拡大縮小のみを反映し、縦横比は固定のまま）
const effectiveMinCellWidth = computed(() => BASE_MIN_CELL_WIDTH * prop.scale);
const effectiveCellHeight = computed(() => BASE_CELL_HEIGHT * prop.scale);

/** グリッドコンテナの実幅から、CSS Gridの`auto-fill`相当の列数を計算する */
function recomputeContainerWidth(): void {
  containerWidth.value = gridRef.value?.clientWidth ?? 0;
}

const columns = computed(() =>
  Math.max(
    1,
    Math.floor((containerWidth.value + GRID_GAP) / (effectiveMinCellWidth.value + GRID_GAP)),
  ),
);

const totalRows = computed(() => Math.max(1, Math.ceil(prop.pageCount / columns.value)));

// ==================== 実マウント範囲（行ウィンドウ）の管理 ====================
// 全ページ分のセルを常時DOMへマウントするとページ数が多い文書でノード数が際限なく増えるため、
// 現在ページ付近の一定行数のみを実マウントし、その前後は高さだけを確保したスペーサーに留める

const renderRowStart = ref(0);
const renderRowEnd = ref(1); // 排他的境界（この行は含まない）

/** 現在ページを含む行を中心に、実マウント範囲を組み直す（初回マウント・列数変化・ページ範囲外への遷移時に使う） */
function resetWindowAroundCurrentPage(): void {
  const currentRow = Math.floor((prop.currentPage - 1) / columns.value);
  const start = Math.max(0, currentRow - ROWS_MARGIN);
  renderRowStart.value = start;
  renderRowEnd.value = Math.min(totalRows.value, start + ROWS_PER_WINDOW);
}

/** 実マウント範囲を上方向へ広げ、下端を詰めてウィンドウ幅を保つ */
function expandWindowUpward(): void {
  if (renderRowStart.value === 0) return;
  renderRowStart.value = Math.max(0, renderRowStart.value - ROWS_MARGIN);
  renderRowEnd.value = Math.min(totalRows.value, renderRowStart.value + ROWS_PER_WINDOW);
}

/** 実マウント範囲を下方向へ広げ、上端を詰めてウィンドウ幅を保つ */
function expandWindowDownward(): void {
  if (renderRowEnd.value >= totalRows.value) return;
  renderRowEnd.value = Math.min(totalRows.value, renderRowEnd.value + ROWS_MARGIN);
  renderRowStart.value = Math.max(0, renderRowEnd.value - ROWS_PER_WINDOW);
}

const renderedIndices = computed<number[]>(() => {
  const startIdx = renderRowStart.value * columns.value;
  const endIdx = Math.min(prop.pageCount, renderRowEnd.value * columns.value);
  return Array.from({ length: Math.max(0, endIdx - startIdx) }, (_, i) => startIdx + i);
});

const topSpacerHeight = computed(
  () => renderRowStart.value * (effectiveCellHeight.value + GRID_GAP),
);
const bottomSpacerHeight = computed(() =>
  Math.max(0, (totalRows.value - renderRowEnd.value) * (effectiveCellHeight.value + GRID_GAP)),
);

// 現在ページがウィンドウ外へ移動した場合（フッターのページ送り等）、ウィンドウを組み直す
watch(
  () => prop.currentPage,
  (page) => {
    const idx = page - 1;
    if (idx < renderRowStart.value * columns.value || idx >= renderRowEnd.value * columns.value) {
      resetWindowAroundCurrentPage();
    }
  },
);

// ==================== スペーサーの交差判定によるウィンドウのスクロール追従 ====================
// root:nullとするのは、このコンポーネントが実際にスクロールしない`.pdf-viewer-container`配下に
// マウントされ、実スクロールは親（DocumentTabView.vue側）の`.document-viewer-wrapper`で発生する
// ため（continuousSingleモードの仮想化と同じ理由。DocumentViewer.vueのコメント参照）

const topSentinel = useTemplateRef('topSentinel');
const bottomSentinel = useTemplateRef('bottomSentinel');
let sentinelObserver: IntersectionObserver | undefined;

function setupSentinelObserver(): void {
  sentinelObserver?.disconnect();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        if (entry.target === topSentinel.value) expandWindowUpward();
        else if (entry.target === bottomSentinel.value) expandWindowDownward();
      }
    },
    { root: null, rootMargin: '200px 0px', threshold: 0 },
  );
  if (topSentinel.value) observer.observe(topSentinel.value);
  if (bottomSentinel.value) observer.observe(bottomSentinel.value);
  sentinelObserver = observer;
}

// ==================== サムネイル生成・キャッシュ ====================

// ページ索引ごとの生成済みサムネイル（dataURL）。実マウント範囲外のページは退避され、
// ページ数によらずメモリ使用量を一定に保つ
const thumbnails = reactive(new Map<number, string>());
// renderedIndicesに含まれる索引の待ち行列（未取得のもののみ積む）
const queue: number[] = [];
// 生成が進行中の索引（同時実行数の上限判定に使う）
const inFlight = new Set<number>();
// 現在「表示すべき」と判定されている索引の集合（renderedIndicesと同期する）
const wantedIndices = new Set<number>();

/**
 * 同時実行数の上限を守りながら、待ち行列に積まれたページのサムネイルを順次生成する
 */
function pump(): void {
  while (inFlight.size < MAX_CONCURRENT_GENERATION && queue.length > 0) {
    const idx = queue.shift();
    if (idx === undefined) break;
    // 待ち行列に積まれてから既に不要になった、または既に生成済みのページはスキップする
    if (!wantedIndices.has(idx) || thumbnails.has(idx)) continue;

    inFlight.add(idx);
    void prop
      .onGenerateThumbnail(idx + 1, THUMBNAIL_MAX_WIDTH)
      .then((dataUrl) => {
        // 生成完了時点でまだ「欲しい集合」に残っている場合のみキャッシュへ反映する
        // （ウィンドウが動いて既に不要になったページの結果を書き込む無駄を避ける）
        if (wantedIndices.has(idx) && dataUrl) thumbnails.set(idx, dataUrl);
      })
      .catch(() => {
        // 生成失敗時は何もしない。thumbnailsに登録されないため、ウィンドウに残り続ける限り
        // 次回のpump()呼び出しで再度生成が試みられる（無期限にスピナーのまま固定されはしない）
      })
      .finally(() => {
        inFlight.delete(idx);
        pump();
      });
  }
}

// ==================== マウント・アンマウント ====================

/** 実マウント範囲内にある現在ページのセルへ、アニメーションなしでスクロールする。
 * ページ一覧モードへ切り替えた直後、直前まで開いていたページが見える状態から開始できるようにする */
function scrollActiveIntoView(): void {
  const active = gridRef.value?.querySelector('.page-list-cell.active');
  active?.scrollIntoView({ block: 'center' });
}

onMounted(() => {
  recomputeContainerWidth();
  // 列数（containerWidthとscaleに依存するcomputed）が確定した状態で、初回のウィンドウを
  // 現在ページを中心に組む。以降の変化はwatch(columns, ...)に任せる
  resetWindowAroundCurrentPage();
  resizeObserver = new ResizeObserver(recomputeContainerWidth);
  if (gridRef.value) resizeObserver.observe(gridRef.value);
  void nextTick(() => {
    setupSentinelObserver();
    scrollActiveIntoView();
  });
});
onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  sentinelObserver?.disconnect();
});

// コンテナ幅の変化（リサイズ）・ズームレベルの変化のいずれによる列数変化でも、
// 現在ページを中心にウィンドウを組み直す
watch(columns, resetWindowAroundCurrentPage);

// 実マウント範囲（renderedIndices）の変化に応じて、サムネイル生成の対象を追従させる
watch(
  renderedIndices,
  (newIndices, oldIndices) => {
    const newSet = new Set(newIndices);
    const oldSet = new Set(oldIndices ?? []);
    for (const idx of newSet) {
      if (oldSet.has(idx)) continue;
      wantedIndices.add(idx);
      if (!thumbnails.has(idx) && !inFlight.has(idx)) queue.push(idx);
    }
    for (const idx of oldSet) {
      if (newSet.has(idx)) continue;
      wantedIndices.delete(idx);
      thumbnails.delete(idx);
      const queuedAt = queue.indexOf(idx);
      if (queuedAt !== -1) queue.splice(queuedAt, 1);
    }
    pump();
  },
  { immediate: true },
);
</script>

<style scoped lang="scss">
@use 'sass:color';

.page-list-grid {
  display: grid;
  gap: 16px;
  padding: 1rem;

  .page-list-spacer {
    grid-column: 1 / -1;
  }

  .page-list-cell {
    all: unset;
    cursor: pointer;
    border: 2px solid $grey-3;
    border-radius: 6px;
    overflow: hidden;
    transition: all 0.2s ease;
    display: flex;
    flex-direction: column;
    background: white;
    box-sizing: border-box;

    &:hover {
      border-color: var(--q-primary);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
      transform: translateY(-2px);
    }

    &:focus-visible {
      outline: 2px solid var(--q-primary);
      outline-offset: 2px;
    }

    &.active {
      border-color: var(--q-primary);
      background-color: var(--q-primary);
      box-shadow: 0 0 0 3px rgba(var(--q-primary-rgb), 0.2);
    }

    img {
      width: 100%;
      flex: 1 1 0;
      min-height: 0;
      object-fit: contain;
      background: white;
    }

    .q-spinner {
      flex: 1 1 0;
      margin: auto;
    }

    .page-number {
      flex-shrink: 0;
      padding: 0.4rem;
      text-align: center;
      font-size: 0.75rem;
      background-color: $grey-2;
      color: $grey-7;
      font-weight: 600;
    }
  }
}

.body--dark .page-list-grid {
  .page-list-cell {
    border-color: $grey-8;
    background: $dark;

    &:hover {
      border-color: var(--q-primary);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    }

    &.active {
      border-color: var(--q-primary);
      background-color: var(--q-primary);
      box-shadow: 0 0 0 3px rgba(var(--q-primary-rgb), 0.3);
    }

    img {
      background: $dark;
    }

    .page-number {
      background-color: $grey-8;
      color: $grey-4;
    }
  }
}
</style>
