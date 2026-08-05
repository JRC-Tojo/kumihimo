<template>
  <div class="page-list-grid">
    <div
      v-for="page in pageCount"
      :key="page"
      :ref="(el) => setWrapperRef(page - 1, el as HTMLElement | null)"
      :class="['page-list-cell', { active: page === currentPage }]"
      :style="pageSizeStyle(page - 1)"
      @click="emit('select-page', page)"
    >
      <img v-if="thumbnails.has(page - 1)" :src="thumbnails.get(page - 1)" :alt="`Page ${page}`" />
      <q-spinner v-else color="primary" class="q-pa-md" />
      <div class="page-number">{{ page }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import type { PageSize } from 'src/components/Viewer/pdfManager';

type GenerateThumbnailFunc = (pageNumber: number, maxWidth: number) => Promise<string>;

interface Prop {
  pageCount: number;
  pageSizes: PageSize[];
  currentPage: number;
  onGenerateThumbnail: GenerateThumbnailFunc;
}
const prop = defineProps<Prop>();

const emit = defineEmits<{ 'select-page': [page: number] }>();

/** サムネイル生成時の最大横幅（px） */
const THUMBNAIL_MAX_WIDTH = 200;
/** サムネイル生成の同時実行数上限。高速スクロール時に大量のcanvas描画が同時発生しないようにする */
const MAX_CONCURRENT_GENERATION = 4;
/** この範囲に入ったページのサムネイル生成を開始する（実際にビューポートへ入る前から準備しておく） */
const PREFETCH_ROOT_MARGIN = '600px 0px';
/** この範囲を完全に外れたページのみサムネイルを退避する。PREFETCH_ROOT_MARGINより広く取ることで、
 * 境界付近の小さなスクロールで生成・退避を繰り返す（スラッシングする）のを防ぐ */
const EVICT_ROOT_MARGIN = '1500px 0px';

// ページ索引ごとの生成済みサムネイル（dataURL）。ページ数によらずメモリ使用量を一定に保つため、
// ビューポート近傍から外れたページは退避（削除）する
const thumbnails = reactive(new Map<number, string>());
// 現在「表示すべき」と判定されているページ索引の集合（プリフェッチ範囲内）。
// この集合から外れたページはthumbnailsから退避する
const wantedIndices = reactive(new Set<number>());
// wantedIndicesに追加されたが、まだ生成中でも生成済みでもない索引の待ち行列
const queue: number[] = [];
// 生成が進行中の索引（同時実行数の上限判定に使う）
const inFlight = new Set<number>();

const wrapperElToIndex = new Map<HTMLElement, number>();
const wrapperRefs = ref<(HTMLElement | null)[]>([]);
let prefetchObserver: IntersectionObserver | undefined;
let evictObserver: IntersectionObserver | undefined;

function setWrapperRef(idx: number, el: HTMLElement | null) {
  const prevEl = wrapperRefs.value[idx];
  if (prevEl) {
    wrapperElToIndex.delete(prevEl);
    prefetchObserver?.unobserve(prevEl);
    evictObserver?.unobserve(prevEl);
  }
  wrapperRefs.value[idx] = el;
  if (el) {
    wrapperElToIndex.set(el, idx);
    prefetchObserver?.observe(el);
    evictObserver?.observe(el);
  }
}

/**
 * 同時実行数の上限を守りながら、待ち行列に積まれたページのサムネイルを順次生成する
 */
function pump() {
  while (inFlight.size < MAX_CONCURRENT_GENERATION && queue.length > 0) {
    const idx = queue.shift();
    if (idx === undefined) break;
    // 待ち行列に積まれてから既に不要になった（スクロールで外れた）、
    // または既に生成済みのページはスキップする
    if (!wantedIndices.has(idx) || thumbnails.has(idx)) continue;

    inFlight.add(idx);
    void prop
      .onGenerateThumbnail(idx + 1, THUMBNAIL_MAX_WIDTH)
      .then((dataUrl) => {
        // 生成完了時点でまだ「欲しい集合」に残っている場合のみキャッシュへ反映する
        // （スクロールで既に不要になったページの結果を書き込む無駄を避ける）
        if (wantedIndices.has(idx) && dataUrl) thumbnails.set(idx, dataUrl);
      })
      .finally(() => {
        inFlight.delete(idx);
        pump();
      });
  }
}

/** ページ索引を「欲しい集合」へ加え、未取得であれば生成待ち行列に積む */
function want(idx: number) {
  if (wantedIndices.has(idx)) return;
  wantedIndices.add(idx);
  if (!thumbnails.has(idx) && !inFlight.has(idx)) {
    queue.push(idx);
    pump();
  }
}

/** ページ索引を「欲しい集合」から外し、生成済みキャッシュがあれば退避する */
function unwant(idx: number) {
  wantedIndices.delete(idx);
  thumbnails.delete(idx);
  const queuedAt = queue.indexOf(idx);
  if (queuedAt !== -1) queue.splice(queuedAt, 1);
}

/**
 * プリフェッチ用・退避用の2つのIntersectionObserverを設定する
 *
 * root:nullとするのは、このコンポーネントが実際にスクロールしない`.pdf-viewer-container`配下に
 * マウントされ、実スクロールは親（DocumentTabView.vue側）の`.document-viewer-wrapper`で発生する
 * ため（continuousSingleモードの仮想化と同じ理由。DocumentViewer.vueのコメント参照）
 */
function setupObservers() {
  prefetchObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const idx = wrapperElToIndex.get(entry.target as HTMLElement);
        if (idx === undefined) continue;
        if (entry.isIntersecting) want(idx);
      }
    },
    { root: null, rootMargin: PREFETCH_ROOT_MARGIN, threshold: 0 },
  );
  evictObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const idx = wrapperElToIndex.get(entry.target as HTMLElement);
        if (idx === undefined) continue;
        if (!entry.isIntersecting) unwant(idx);
      }
    },
    { root: null, rootMargin: EVICT_ROOT_MARGIN, threshold: 0 },
  );

  wrapperRefs.value.forEach((el) => {
    if (!el) return;
    prefetchObserver?.observe(el);
    evictObserver?.observe(el);
  });
}

/** プレースホルダー・サムネイルどちらでも、ページの縦横比に応じたレイアウトサイズを確保する */
function pageSizeStyle(idx: number): Record<string, string> | undefined {
  const size = prop.pageSizes[idx];
  if (!size) return undefined;
  return { aspectRatio: `${size.width} / ${size.height}` };
}

onMounted(() => {
  void nextTick(setupObservers);
});
onBeforeUnmount(() => {
  prefetchObserver?.disconnect();
  evictObserver?.disconnect();
});
</script>

<style scoped lang="scss">
@use 'sass:color';

.page-list-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 1rem;
  padding: 1rem;

  .page-list-cell {
    cursor: pointer;
    border: 2px solid $grey-3;
    border-radius: 6px;
    overflow: hidden;
    transition: all 0.2s ease;
    display: flex;
    flex-direction: column;
    background: white;

    &:hover {
      border-color: $primary;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
      transform: translateY(-2px);
    }

    &.active {
      border-color: $primary;
      background-color: color.adjust($primary, $lightness: 45%);
      box-shadow: 0 0 0 3px rgba($primary, 0.2);
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
      border-color: $primary;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    }

    &.active {
      border-color: $primary;
      background-color: color.adjust($primary, $lightness: 25%);
      box-shadow: 0 0 0 3px rgba($primary, 0.3);
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
