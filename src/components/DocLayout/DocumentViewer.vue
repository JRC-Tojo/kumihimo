<template>
  <div class="pdf-editor-page">
    <div
      v-if="onRender !== undefined"
      class="pdf-viewer-container"
      :style="containerMarginStyle"
      @wheel="handleZoomWheel"
      ref="viewerContainer"
    >
      <!-- 単一ページまたは見開き表示 -->
      <div v-if="viewMode === 'single'" class="pages-container" ref="singlePageContainer">
        <PdfPage
          :file="prop.file"
          :annotations="annotations"
          :page-size1x="pageSizes[currentPage - 1]!"
          v-model:selected-annot-ids="selectedAnnotIds"
          v-model:page="currentPage"
          v-model:scale="scale"
          @register-annot="registAnnotation"
          @register-annot-batch="registAnnotationBatch"
          @duplicate-batch="duplicateAnnotationBatch"
          @remove-annot="removeAnnotation"
          @render="onRender"
          @render-tile="onRenderTile"
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
          :ref="wrapperRefCallback(page - 1)"
        >
          <div
            :class="['continuous-page', { active: page === currentPage }]"
            :style="pageSizeStyle(page - 1)"
            :ref="pageRefCallback(page - 1)"
          >
            <PdfPage
              v-if="shouldRenderPage(page - 1)"
              :file="prop.file"
              :page="page"
              :annotations="annotations"
              :page-size1x="pageSizes[page - 1]!"
              v-model:selected-annot-ids="selectedAnnotIds"
              v-model:scale="scale"
              @register-annot="registAnnotation"
              @register-annot-batch="registAnnotationBatch"
              @duplicate-batch="duplicateAnnotationBatch"
              @remove-annot="removeAnnotation"
              @render="onRender"
              @render-tile="onRenderTile"
            />
          </div>
        </div>
      </div>

      <!-- ページ一覧表示：ドキュメント全体をサムネイルのグリッドとして俯瞰する -->
      <DocumentPageListView
        v-if="viewMode === 'pageList'"
        :page-count="pageCount"
        :current-page="currentPage"
        :scale="scale"
        @generate-thumbnail="onGenerateThumbnail"
        @select-page="onSelectPage"
      />
    </div>
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
import type { ComponentPublicInstance } from 'vue';
import PdfPage from 'src/components/Viewer/PdfPage.vue';
import DocumentPageListView from './DocumentPageListView.vue';
import type { ViewMode } from 'src/models/docPage';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import type { AnnotationGroup } from 'src/models/document/group';
import { useAnnotationHistory } from './composables/useAnnotationHistory';
import { useBackendApi } from 'src/apis/backendApi';
import { useGroupStore } from 'src/stores/groupStore';
import { fileKey } from 'src/utils/document/fileKey';
import type { ContainerElementFile } from 'src/models/container';
import type { PageSize } from 'src/components/Viewer/pdfManager';
import type { TileDescriptor } from 'src/components/Viewer/tiling';
import { PDF_VIEWER_CONTAINER_MARGIN_PT } from 'src/components/Viewer/zoomSteps';

type RenderFunc = (
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number,
) => Promise<PageSize>;
type RenderTileFunc = (
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number,
  tile: TileDescriptor,
  dpr: number,
) => Promise<void>;
type GenerateThumbnailFunc = (pageNumber: number, maxWidth: number) => Promise<string>;
interface Prop {
  pageCount: number;
  pageSizes: PageSize[];
  viewMode: ViewMode;
  file: ContainerElementFile;
  annotations: AnnotationStyle[];
  onRender: RenderFunc;
  onRenderTile: RenderTileFunc;
  onGenerateThumbnail: GenerateThumbnailFunc;
  onZoomIn: (clientX?: number, clientY?: number) => void;
  onZoomOut: (clientX?: number, clientY?: number) => void;
  onScrollToCurrentPage: (viewerContainerHeight: number) => void;
  onSelectPage: (page: number) => void;
}
const prop = defineProps<Prop>();

const history = useAnnotationHistory();
const api = useBackendApi();
const groupStore = useGroupStore();

const currentPage = defineModel<number>('currentPage', { required: true });
const zoomLevel = defineModel<number>('zoomLevel', { required: true });
const selectedAnnotIds = defineModel<AnnotationID[]>('selectedAnnotIds', { required: true });

// ズーム制御
const scale = computed(() => zoomLevel.value / 100);

// .pdf-viewer-containerの余白をzoomSteps.tsの共有定数から与える（フィット計算側と値がズレないように、
// SCSS側には固定値を直書きせずCSSカスタムプロパティ経由で反映する）
const containerMarginStyle = computed(() => ({
  '--pdf-viewer-container-margin': `${PDF_VIEWER_CONTAINER_MARGIN_PT}pt`,
}));

// 連続表示モード用
const pageRefs = ref<(HTMLElement | null)[]>([]);
const viewerContainer = useTemplateRef('viewerContainer');
const singlePageContainer = useTemplateRef('singlePageContainer');

/**
 * ズームのアンカー計算用に、現在表示中のページ自体のDOM矩形を返す。
 *
 * `.pages-container`/`.continuous-pages`は`margin: auto` + `max-width: fit-content`で
 * 水平方向に中央寄せされており、この余白幅はズーム倍率が変わるたびに変化する。また連続表示モードでは
 * ページ間に`q-mb-md`という固定（スケールに連動しない）マージンが挟まるため、スクロールコンテナ全体を
 * 単一のスケール係数で線形にモデル化することはできない。
 * 個々のページ要素自身の矩形（内部に余白を持たず、常にscaleに比例したサイズになる）を直接測定することで、
 * これらの非線形要素を計算に含めずにズーム前後のアンカー位置を求められるようにする
 */
function getAnchorRect(): DOMRect | undefined {
  if (prop.viewMode === 'continuousSingle') {
    return pageRefs.value[currentPage.value - 1]?.getBoundingClientRect();
  }
  return singlePageContainer.value?.getBoundingClientRect();
}

defineExpose({ getAnchorRect });

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
 * 現在ページの前後何ページ分を、IntersectionObserverの交差判定を待たずに常に実描画しておくか。
 * マウント直後（初回コールバック前で`pageVisibleRatios`が空）の保険的な最小保証であり、
 * 画面内に実際に交差しているページ数を制限するものではない（そちらは`pageVisibleRatios`で判定する）
 */
const ADJACENT_RENDER_MARGIN = 1;

const wrapperElToIndex = new Map<HTMLElement, number>();
const wrapperRefs = ref<(HTMLElement | null)[]>([]);
// ページ索引ごとの、実ビューポートに対する交差率（0〜1）。「現在ページ」の判定にのみ使う。
// reactiveでラップすることで、IntersectionObserverによる更新がshouldRenderPageの再評価
// （テンプレート内のv-if）を正しくトリガーするようにする
const pageVisibleRatios = reactive(new Map<number, number>());
let currentPageObserver: IntersectionObserver | undefined;
// スクロール追従によるcurrentPage更新が、下の`watch(currentPage, ...)`による
// 「ページ位置へスクロールし直す」処理を誤って引き起こさないようにするためのガード
let isSyncingCurrentPageFromScroll = false;

function setWrapperRef(idx: number, el: HTMLElement | null) {
  const prevEl = wrapperRefs.value[idx];
  if (prevEl === el) return; // 実際に要素が変わっていない再登録は無視する（監視の張り直しによる交差率ロストを防ぐ）
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

// テンプレートの`v-for`内でrefコールバックを毎レンダー無名関数として書くと、Vueはref参照の
// 同一性比較で「変わった」と判定し、DOM要素自体が変わっていなくても毎回setWrapperRefへ
// null→要素の順で呼び直してしまう（Vueの既知の挙動）。これによりIntersectionObserverの
// unobserve/observeが際限なく繰り返され、その狭間でブラウザ側の交差通知が失われるページが
// 発生し、低倍率で多数ページが同時に見えている場合ほど「実際は見えているのに描画されない」
// ページが増える不具合が起きていた。ページ索引ごとにコールバック自体をキャッシュし、
// 同一関数を使い続けることでVueが不要な再登録を行わないようにする
type ElRef = Element | ComponentPublicInstance | null;

const wrapperRefCallbacks: ((el: ElRef) => void)[] = [];
function wrapperRefCallback(idx: number): (el: ElRef) => void {
  return (wrapperRefCallbacks[idx] ??= (el) => setWrapperRef(idx, el as HTMLElement | null));
}

const pageRefCallbacks: ((el: ElRef) => void)[] = [];
function pageRefCallback(idx: number): (el: ElRef) => void {
  return (pageRefCallbacks[idx] ??= (el) => {
    if (el) pageRefs.value[idx] = el as HTMLElement;
  });
}

/**
 * 指定ページを実描画（PdfPageマウント）対象にすべきか判定する。
 * 現在ページ近傍（`ADJACENT_RENDER_MARGIN`以内）のページと、実際にビューポートへ
 * 交差しているページを描画対象とする
 */
function shouldRenderPage(idx: number): boolean {
  if (prop.viewMode !== 'continuousSingle') return true;
  // マウント直後（IntersectionObserverの初回コールバック前）はpageVisibleRatiosが空のため、
  // 現在ページ近傍は常に描画対象にしておく（今までと同じ挙動を保証するフォールバック）
  if (Math.abs(idx - (currentPage.value - 1)) <= ADJACENT_RENDER_MARGIN) return true;
  // 実際にビューポートへ交差しているページは、拡大率が低くビューポートに何ページ入るかに
  // かかわらずすべて描画対象にする（固定マージンでは低倍率で多数ページが同時に見える場合に
  // 一部が描画されなかった）
  return (pageVisibleRatios.get(idx) ?? 0) > 0;
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
 * ズームをホイールで制御（カーソル位置を基準にズームするため、クリック座標を伝える）
 */
function handleZoomWheel(event: WheelEvent) {
  if (event.ctrlKey) {
    event.preventDefault();
    if (event.deltaY < 0) {
      prop.onZoomIn(event.clientX, event.clientY);
    } else {
      prop.onZoomOut(event.clientX, event.clientY);
    }
  }
}

/**
 * アノテーションを登録
 */
async function registAnnotation(annot: AnnotationStyle): Promise<void> {
  const previous = prop.annotations.find((a) => a.id === annot.id);
  const registRes = await history.registerWithHistory(prop.file, previous, annot);
  if (!registRes.ok) console.log(registRes.error); // TODO: エラーハンドリング
}

/**
 * 複数アノテーションの登録（グループ・複数選択の同時ドラッグ/リサイズ）を1件のUndoステップとして記録する
 */
async function registAnnotationBatch(annots: AnnotationStyle[]): Promise<void> {
  const items = annots.map((annot) => ({
    previous: prop.annotations.find((a) => a.id === annot.id) ?? annot,
    next: annot,
  }));
  await history.registerManyWithHistory(prop.file, items);
}

/**
 * Ctrl+drag複製を確定する（単一シェイプ・複数選択・グループのいずれも同じ経路で扱う）
 *
 * ペーストと同じ`pasteAnnotations`パイプラインを使い、複製元の選択がまるごと1つのグループ
 * だった場合は複製後も同じ値算出方法で新しいグループを作り直す。作成結果は1件のUndoステップとして記録する
 */
async function duplicateAnnotationBatch(
  sources: AnnotationStyle[],
  offset: { dx: number; dy: number },
  page: number,
  isGroup: boolean,
): Promise<AnnotationStyle[]> {
  const res = await api.pasteAnnotations(prop.file, sources, page, offset);
  if (!res.ok) return [];
  const created = res.data.map((info) => info.style);

  let createdGroup: AnnotationGroup | undefined;
  if (isGroup && created.length >= 2) {
    const sourceGroup = groupStore.matchingGroup(
      fileKey(prop.file),
      sources.map((s) => s.id),
    );
    const groupRes = await api.groupAnnotations(
      prop.file,
      created.map((a) => a.id),
    );
    if (groupRes.ok) {
      createdGroup = groupRes.data.group;
      if (sourceGroup?.valueAggregation) {
        const aggRes = await api.updateGroupValueAggregation(
          prop.file,
          createdGroup.id,
          sourceGroup.valueAggregation,
        );
        if (aggRes.ok) createdGroup = aggRes.data;
      }
      await groupStore.refreshFile(prop.file);
    }
  }

  history.recordCreatedBatchWithGroup(prop.file, created, createdGroup);
  return created;
}

/**
 * アノテーションを削除
 */
async function removeAnnotation(annotID: AnnotationID): Promise<void> {
  const removed = prop.annotations.find((a) => a.id === annotID);
  if (!removed) return;
  const removeRes = await history.removeWithHistory(prop.file, removed);
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
  margin: var(--pdf-viewer-container-margin);
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
