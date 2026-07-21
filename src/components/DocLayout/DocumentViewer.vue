<template>
  <div class="pdf-editor-page">
    <div
      v-if="onRender !== undefined"
      class="pdf-viewer-container"
      @wheel="handleZoomWheel"
      ref="viewerContainer"
    >
      <!-- 単一ページまたは見開き表示 -->
      <div v-if="viewMode === 'single'" class="pages-container">
        <PdfPage
          :annotations="annotations"
          v-model:selected-annot-ids="selectedAnnotIds"
          v-model:page="currentPage"
          v-model:scale="scale"
          @register-annot="registAnnotation"
          @remove-annot="removeAnnotation"
          @render="onRender"
        />
      </div>

      <!-- 連続表示: ページ数が多い文書で全ページ分のcanvas・Konva Stageが常駐しないよう、
           ビューポート近傍のページのみ実際にPdfPageをマウントし、それ以外は
           レイアウト上のサイズのみ確保したプレースホルダーにする（仮想化） -->
      <div v-if="viewMode === 'continuousSingle'" class="continuous-pages">
        <div
          v-for="page in pageCount"
          :key="page"
          class="q-mb-md continuous-page-wrapper"
          :ref="(el) => setWrapperRef(page - 1, el as HTMLElement | null)"
        >
          <div
            :class="['continuous-page', { active: page === currentPage }]"
            :style="pageSizeStyle(page - 1)"
            :ref="
              (el) => {
                if (el) pageRefs[page - 1] = el as HTMLElement;
              }
            "
          >
            <PdfPage
              v-if="shouldRenderPage(page - 1)"
              :page="page"
              :annotations="annotations"
              v-model:selected-annot-ids="selectedAnnotIds"
              v-model:scale="scale"
              @register-annot="registAnnotation"
              @remove-annot="removeAnnotation"
              @render="onRender"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import PdfPage from 'src/components/Viewer/PdfPage.vue';
import type { ViewMode } from 'src/models/docPage';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import { useBackendApi } from 'src/apis/backendApi';
import type { ContainerElementFile } from 'src/models/container';
import type { PageSize } from 'src/components/Viewer/pdfManager';

type RenderFunc = (
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number,
) => Promise<PageSize>;
interface Prop {
  pageCount: number;
  pageSizes: PageSize[];
  viewMode: ViewMode;
  file: ContainerElementFile;
  annotations: AnnotationStyle[];
  onRender: RenderFunc;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onScrollToCurrentPage: (viewerContainerHeight: number) => void;
}
const prop = defineProps<Prop>();

const api = useBackendApi();

const currentPage = defineModel<number>('currentPage', { required: true });
const zoomLevel = defineModel<number>('zoomLevel', { required: true });
const selectedAnnotIds = defineModel<AnnotationID[]>('selectedAnnotIds', { required: true });

// ズーム制御
const scale = computed(() => zoomLevel.value / 100);

// 連続表示モード用
const pageRefs = ref<(HTMLElement | null)[]>([]);
const viewerContainer = useTemplateRef('viewerContainer');

// ============ 連続表示モードの仮想化 ============
// 「現在表示中のページ」をスクロール位置から正確に追跡し、そのページの前後
// `ADJACENT_RENDER_MARGIN`ページ分のみ実際にPdfPage（Canvas+Konva Stage）をマウントする。
// それ以外は`pageSizeStyle`でレイアウト上のサイズのみ確保したプレースホルダーにする。
// これによりページ数が多い文書でも、常駐するcanvas・Konva Stageの数を現在ページ近傍分に抑えられる。
//
// （以前はIntersectionObserverの`isIntersecting`だけで「描画すべきページ」集合を直接管理していたが、
// 「現在ページ」自体がスクロールに追従しておらず固定されたままだったため、現在ページから離れた
// 位置までスクロールすると描画判定の基準がずれてページが非表示になる不具合があった。
// スクロール位置から正確に「現在ページ」を求め、そこからの相対位置で描画要否を判定する方式に改めた）

/**
 * 現在ページの前後何ページ分を常に実描画（非仮想化）しておくか。
 * ビューポートの高さが低倍率ズーム等で複数ページ分に及ぶ場合は、この値を大きくすることで
 * 画面内の全ページを確実に実描画できる
 */
const ADJACENT_RENDER_MARGIN = 1;

const wrapperElToIndex = new Map<HTMLElement, number>();
const wrapperRefs = ref<(HTMLElement | null)[]>([]);
// ページ索引ごとの、実ビューポートに対する交差率（0〜1）。「現在ページ」の判定にのみ使う
const pageVisibleRatios = new Map<number, number>();
let currentPageObserver: IntersectionObserver | undefined;
// スクロール追従によるcurrentPage更新が、下の`watch(currentPage, ...)`による
// 「ページ位置へスクロールし直す」処理を誤って引き起こさないようにするためのガード
let isSyncingCurrentPageFromScroll = false;

function setWrapperRef(idx: number, el: HTMLElement | null) {
  const prevEl = wrapperRefs.value[idx];
  if (prevEl) {
    wrapperElToIndex.delete(prevEl);
    currentPageObserver?.unobserve(prevEl);
    pageVisibleRatios.delete(idx);
  }
  wrapperRefs.value[idx] = el;
  if (el) {
    wrapperElToIndex.set(el, idx);
    currentPageObserver?.observe(el);
  }
}

function shouldRenderPage(idx: number): boolean {
  if (prop.viewMode !== 'continuousSingle') return true;
  return Math.abs(idx - (currentPage.value - 1)) <= ADJACENT_RENDER_MARGIN;
}

/** プレースホルダー・実描画のどちらでも、現在のズーム倍率に応じたレイアウトサイズを確保する */
function pageSizeStyle(idx: number): Record<string, string> | undefined {
  const size = prop.pageSizes[idx];
  if (!size) return undefined;
  return {
    width: `${size.width * scale.value}px`,
    height: `${size.height * scale.value}px`,
  };
}

/** 交差率が最も高いページを「現在ページ」としてcurrentPageへ反映する */
function updateCurrentPageFromRatios() {
  let maxIdx = -1;
  let maxRatio = 0;
  for (const [idx, ratio] of pageVisibleRatios) {
    if (ratio > maxRatio) {
      maxRatio = ratio;
      maxIdx = idx;
    }
  }
  if (maxIdx === -1) return; // どのページも見えていない（初期化前後等）場合は変更しない

  const nextPage = maxIdx + 1;
  if (nextPage === currentPage.value) return;

  isSyncingCurrentPageFromScroll = true;
  currentPage.value = nextPage;
  void nextTick(() => {
    isSyncingCurrentPageFromScroll = false;
  });
}

// 実際にスクロールするのは`.document-viewer-wrapper`（このコンポーネントの外、DocumentTabView.vue側）
// であり、`viewerContainer`（.pdf-viewer-container）自体はoverflow指定を持たずコンテンツに合わせて
// 伸びるだけの要素のため、これをrootに指定すると常に全ページが「交差している」と判定されてしまう。
// rootをnull（＝ブラウザビューポート）にすることで、IntersectionObserverの仕様通り、途中の
// `.document-viewer-wrapper`によるoverflowクリップも考慮した交差判定になる。
// thresholdを細かく刻むことで、スクロール中も各ページの交差率をなめらかに追跡できるようにする
const RATIO_THRESHOLDS = Array.from({ length: 11 }, (_, i) => i / 10);

function setupIntersectionObserver() {
  currentPageObserver?.disconnect();
  pageVisibleRatios.clear();
  if (prop.viewMode !== 'continuousSingle') return;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const idx = wrapperElToIndex.get(entry.target as HTMLElement);
        if (idx === undefined) continue;
        pageVisibleRatios.set(idx, entry.intersectionRatio);
      }
      updateCurrentPageFromRatios();
    },
    { root: null, rootMargin: '0px', threshold: RATIO_THRESHOLDS },
  );
  wrapperRefs.value.forEach((el) => {
    if (el) observer.observe(el);
  });

  currentPageObserver = observer;
}

/**
 * ズームをホイールで制御
 */
function handleZoomWheel(event: WheelEvent) {
  if (event.ctrlKey) {
    event.preventDefault();
    if (event.deltaY < 0) {
      prop.onZoomIn();
    } else {
      prop.onZoomOut();
    }
  }
}

/**
 * アノテーションを登録
 */
async function registAnnotation(annot: AnnotationStyle): Promise<void> {
  const registRes = await api.registerAnnotationStyle(prop.file, annot);
  if (!registRes.ok) console.log(registRes.error); // TODO: エラーハンドリング
}

/**
 * アノテーションを削除
 */
async function removeAnnotation(annotID: AnnotationID): Promise<void> {
  const removeRes = await api.removeAnnotation(annotID);
  if (!removeRes.ok) console.log(removeRes.error); // TODO: エラーハンドリング
}

watch(currentPage, () => {
  // スクロール追従によるcurrentPage更新の場合、既にその位置へスクロール済みのため
  // 「ページ位置へスクロールし直す」処理を呼ぶと無限ループ・スクロールの奪い合いになる
  if (isSyncingCurrentPageFromScroll) return;
  void prop.onScrollToCurrentPage(viewerContainer.value?.getBoundingClientRect().height ?? 0);
});

watch(
  () => prop.viewMode,
  () => {
    if (prop.viewMode === 'continuousSingle') {
      void nextTick(() => {
        setupIntersectionObserver();
        void prop.onScrollToCurrentPage(viewerContainer.value?.getBoundingClientRect().height ?? 0);
      });
    } else {
      currentPageObserver?.disconnect();
    }
  },
);

onMounted(() => {
  if (prop.viewMode === 'continuousSingle') {
    void nextTick(setupIntersectionObserver);
  }
});
onBeforeUnmount(() => {
  currentPageObserver?.disconnect();
});
</script>

<style scoped lang="scss">
@use 'sass:color';

.pdf-editor-page {
  height: 100%;
  width: 100%;
  background: $grey-1;
}

.body--dark .pdf-editor-page {
  background: color.adjust($dark, $lightness: -5%);
}

.pdf-viewer-container {
  margin: 10pt;
  background: $grey-1;

  &::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  &::-webkit-scrollbar-track {
    background: $grey-2;
  }

  &::-webkit-scrollbar-thumb {
    background: $grey-4;
    border-radius: 4px;

    &:hover {
      background: $grey-5;
    }
  }

  .pages-container {
    margin: auto;
    max-width: fit-content;
  }

  .continuous-pages {
    margin: auto;
    max-width: fit-content;
    display: flex;
    flex-direction: column;

    .continuous-page-wrapper {
      width: 100%;
    }
  }
}

.body--dark .pdf-viewer-container {
  background: color.adjust($dark, $lightness: -5%);

  &::-webkit-scrollbar-track {
    background: $grey-8;
  }

  &::-webkit-scrollbar-thumb {
    background: $grey-7;

    &:hover {
      background: $grey-6;
    }
  }

  .continuous-pages {
    .continuous-page-wrapper {
      .continuous-page {
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);

        &.active {
          box-shadow: 0 4px 16px rgba(25, 118, 210, 0.4);
        }

        &:hover {
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6);
        }
      }
    }
  }
}
</style>
