<template>
  <div class="document-layout row">
    <!-- 左Drawer：ドキュメント情報とサムネイル -->
    <DocumentLeftDrawer
      v-model:drawer-open="editorStore.leftDrawerModel"
      :total-page-count="pageCount"
      :current-page="currentPage"
      :thumnails="thumbnails"
      @go-to-page="goToPage"
      class="col-1"
    />

    <!-- メインコンテンツ領域 -->
    <div class="document-main-content col">
      <!-- タブコンテンツ：文書とアノテーション表示 -->
      <div ref="viewer" class="document-viewer-wrapper">
        <DocumentViewer
          v-if="!loading && onRender"
          :file="file"
          :page-count="pageCount"
          :view-mode="viewMode"
          :annotations="annotations"
          @render="onRender"
          @zoom-in="zoomIn"
          @zoom-out="zoomOut"
          @scroll-to-current-page="scrollToCurrentPage"
          v-model:selected-annot-ids="selectedAnnotationIds"
          v-model:current-page="currentPage"
          v-model:zoom-level="zoomLevel"
        />
        <div v-else-if="loading" class="loading-state fit">
          <q-spinner color="primary" size="3em" />
          <p class="q-mt-md">{{ $t('pdfEditor.document.loading') }}</p>
        </div>
      </div>

      <!-- フッター：ページネーション、ズーム等 -->
      <DocumentFooter
        v-model:current-page="currentPage"
        v-model:view-mode="viewMode"
        v-model:zoom-level="zoomLevel"
        :total-page-count="pageCount"
        :scale="zoomLevel"
        @go-to-first-page="goToFirstPage"
        @previous-page="previousPage"
        @next-page="nextPage"
        @go-to-last-page="goToLastPage"
        @go-to-page="goToPage"
        @set-zoom="setZoomLevel"
        @zoom-in="zoomIn"
        @zoom-out="zoomOut"
      />
    </div>

    <!-- 右Drawer：アノテーションプロパティ -->
    <DocumentRightDrawer
      :selected-annots="selectedAnnotations"
      v-model:drawer-open="editorStore.rightDrawerModel"
      class="col-1"
    />
  </div>
</template>

<script setup lang="ts">
import DocumentLeftDrawer from 'src/components/DocLayout/DocumentLeftDrawer.vue';
import DocumentViewer from 'src/components/DocLayout/DocumentViewer.vue';
import DocumentRightDrawer from 'src/components/DocLayout/DocumentRightDrawer.vue';
import DocumentFooter from 'src/components/DocLayout/DocumentFooter.vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { useBackendApi } from 'src/apis/backendApi';
import { generateThumbnail, loadPdf, renderPage } from '../Viewer/pdfManager';
import type { ViewMode } from 'src/models/docPage';
import { useEditorStore } from 'src/stores/editorStore';
import { callEditorTools } from 'src/stores/editorTools';
import type { ContainerElementFile } from 'src/models/container';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';

interface Prop {
  file: ContainerElementFile;
}
const prop = defineProps<Prop>();
const viewer = useTemplateRef('viewer');
const api = useBackendApi();

const editorStore = useEditorStore();

// TODO: PDFの読み込みに失敗した場合、Loading画面を抜けてエラーが起きた旨を通知する仕様に修正
const loading = ref<boolean>(true);

// for drawers
const thumbnails = ref<string[]>([]);

// for document
type RenderFunc = (pageNumber: number, canvas: HTMLCanvasElement, scale: number) => Promise<void>;
const onRender = ref<RenderFunc>();
const currentPage = ref(1);
const pageCount = ref(0);
let stopAnnotationObservation: (() => void) | undefined;

// for annotations
const annotations = ref<AnnotationStyle[]>([]);
const selectedAnnotationIds = ref<AnnotationID[]>([]);
const selectedAnnotations = computed(() =>
  selectedAnnotationIds.value
    .map((aId) => annotations.value.find((annot) => annot.id === aId))
    .filter((annot) => annot !== void 0),
);
// バックエンド側のアノテーション情報の更新を反映する
const observed = api.observedAnnotationStylesByFile(prop.file);
if (observed.ok) {
  const subscription = observed.data.subscribe((value) => {
    annotations.value = value;
    selectedAnnotationIds.value = selectedAnnotationIds.value.filter((aId) =>
      value.some((annot) => annot.id === aId),
    );
  });
  stopAnnotationObservation = () => subscription.unsubscribe();
}

// for footer
const zoomLevel = ref(100);
const viewMode = ref<ViewMode>('single');

// ================================

async function loadDocument() {
  loading.value = true;

  const docSrc = await api.getDocumentSource(prop.file);
  if (!docSrc.ok) {
    loading.value = false;
    return;
  }

  // PDFファイルを読み込む
  const loadDocument = await loadPdf(docSrc.data);
  pageCount.value = loadDocument.numPages;

  // レンダリング関数を設定
  onRender.value = async (
    pageNumber: number,
    canvas: HTMLCanvasElement,
    scale: number,
  ): Promise<void> => {
    return await renderPage(loadDocument, pageNumber, canvas, scale);
  };

  // サムネイルを生成
  thumbnails.value = await Promise.all(
    Array.from({ length: pageCount.value }, (_, idx) =>
      generateThumbnail(loadDocument, idx + 1, 120),
    ),
  );

  loading.value = false;
}

// ================================

/**
 * ズームレベルを設定
 */
const setZoomLevel = (level: number): void => {
  const MIN_ZOOM = 20;
  const MAX_ZOOM = 800;
  zoomLevel.value = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, level));
};

/**
 * ズームイン
 */
const zoomIn = (step: number = 5): void => {
  setZoomLevel(zoomLevel.value + step);
};

/**
 * ズームアウト
 */
const zoomOut = (step: number = 5): void => {
  setZoomLevel(zoomLevel.value - step);
};

// ================================

/**
 * 最初のページへ移動
 */
const goToFirstPage = (): void => {
  currentPage.value = 1;
};

/**
 * 前のページへ移動
 */
const previousPage = (): void => {
  currentPage.value = Math.max(1, currentPage.value - 1);
};

/**
 * 指定したページへ移動
 */
const goToPage = (page: number): void => {
  currentPage.value = Math.max(1, Math.min(pageCount.value, Math.floor(page)));
};

/**
 * 次のページへ移動
 */
const nextPage = (): void => {
  currentPage.value = Math.min(pageCount.value, currentPage.value + 1);
};

/**
 * 最後のページへ移動
 */
const goToLastPage = (): void => {
  currentPage.value = pageCount.value;
};

// ================================

/**
 * 連続表示モード時に現在ページをビューにスクロール
 */
async function scrollToCurrentPage(viewerContainerHeight: number) {
  if (viewMode.value !== 'continuousSingle') return;

  await nextTick();

  if (viewer.value) {
    viewer.value.scrollTo({
      top: viewerContainerHeight * ((currentPage.value - 1) / pageCount.value),
    });
  }
}

// ================================

onMounted(async () => {
  const { t } = useI18n();
  editorStore.initStore(await callEditorTools(t));
  await loadDocument();
});

onBeforeUnmount(() => {
  stopAnnotationObservation?.();
});
</script>

<style scoped lang="scss">
@use 'sass:color';

.document-layout {
  height: 100%;
  width: 100%;
  background: white;
  overflow: hidden;
}

.body--dark .document-layout {
  background: $dark;
}

.document-main-content {
  display: flex;
  flex-direction: column;
  background: $grey-1;
  height: 100%;
  width: 100%;
}

.body--dark .document-main-content {
  background: color.adjust($dark, $lightness: -5%);
}

.document-viewer-wrapper {
  flex: 1 1 0;
  overflow: auto;
  background: $grey-1;
  width: 100%;
}

.body--dark .document-viewer-wrapper {
  background: color.adjust($dark, $lightness: -5%);
}

.loading-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: $grey-1;
}

.body--dark .loading-state {
  background: color.adjust($dark, $lightness: -5%);
}
</style>
