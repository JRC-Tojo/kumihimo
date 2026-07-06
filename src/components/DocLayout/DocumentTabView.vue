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
          @render="onRender"
          @zoom-in="zoomIn"
          @zoom-out="zoomOut"
          @scroll-to-current-page="scrollToCurrentPage"
          v-model:annotations="annotations"
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
      v-model:drawer-open="editorStore.rightDrawerModel"
      v-model:selected-ant="selectedAnnotations"
      class="col-1"
    />
  </div>
</template>

<script setup lang="ts">
import DocumentLeftDrawer from 'src/components/DocLayout/DocumentLeftDrawer.vue';
import DocumentViewer from 'src/components/DocLayout/DocumentViewer.vue';
import DocumentRightDrawer from 'src/components/DocLayout/DocumentRightDrawer.vue';
import DocumentFooter from 'src/components/DocLayout/DocumentFooter.vue';
import { nextTick, onMounted, ref, useTemplateRef, watch } from 'vue';
import { useBackendApi } from 'src/apis/backendApi';
import { generateThumbnail, loadPdf, renderPage } from '../Viewer/pdfManager';
import * as annotationService from 'src/services/document/annotation';
import type { ViewMode } from 'src/models/docPage';
import { useEditorStore } from 'src/stores/editorStore';
import { callEditorTools } from 'src/stores/editorTools';
import { useI18n } from 'vue-i18n';
import type { ContainerElementFile } from 'src/models/container';
import type { AnnotationStyle } from 'src/models/document/pdf';

interface Prop {
  file: ContainerElementFile;
}
const prop = defineProps<Prop>();
const viewer = useTemplateRef('viewer');

const editorStore = useEditorStore();

// TODO: PDFの読み込みに失敗した場合、Loading画面を抜けてエラーが起きた旨を通知する仕様に修正
const loading = ref<boolean>(true);

// for drawers
const thumbnails = ref<string[]>([]);

// for document
type RenderFunc = (pageNumber: number, canvas: HTMLCanvasElement, scale: number) => Promise<void>;
const onRender = ref<RenderFunc>();
const annotations = ref<AnnotationStyle[]>([]);
const selectedAnnotations = ref<AnnotationStyle[]>([]);
const currentPage = ref(1);
const pageCount = ref(0);
let stopAnnotationObservation: (() => void) | undefined;
let isHydratingAnnotations = true;
let isApplyingDbAnnotations = false;

// for footer
const zoomLevel = ref(100);
const viewMode = ref<ViewMode>('single');

// ================================

async function loadDocument() {
  loading.value = true;

  const api = useBackendApi();
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

  const dbInitRes = await annotationService.initAnnotDB();
  if (!dbInitRes.ok) {
    console.error(dbInitRes.error);
  }

  const storedAnnotations = await annotationService.getAnnotationsByFile(prop.file);
  if (storedAnnotations.ok && storedAnnotations.value.length > 0) {
    isApplyingDbAnnotations = true;
    annotations.value = storedAnnotations.value.map((info) => info.style);
    isApplyingDbAnnotations = false;
  } else {
    const annotationRes = await api.getAnnotationsBySource(docSrc.data);
    if (annotationRes.ok && annotationRes.data && annotationRes.data.length > 0) {
      annotations.value = annotationRes.data;
      const saveRes = await annotationService.registerAnnotationInfo(
        annotationRes.data.map((style) => ({
          style,
          context: { text: '' },
        })),
        prop.file,
      );
      if (!saveRes.ok) console.error(saveRes.error);
      await annotationService.saveAnnotationInfo(prop.file);
    }
  }

  stopAnnotationObservation?.();
  stopAnnotationObservation = annotationService.observeAnnotationsByFile(prop.file, (infos) => {
    isApplyingDbAnnotations = true;
    annotations.value = infos.map((info) => info.style);
    isApplyingDbAnnotations = false;
  });

  isHydratingAnnotations = false;
  loading.value = false;
}

watch(
  annotations,
  async (newAnnotations, oldAnnotations) => {
    if (isHydratingAnnotations || isApplyingDbAnnotations) return;
    if (oldAnnotations === undefined) return;

    const oldIds = new Set(oldAnnotations.map((annotation) => annotation.id));
    const newIds = new Set(newAnnotations.map((annotation) => annotation.id));
    const removedIds = [...oldIds].filter((id) => !newIds.has(id));

    for (const removedId of removedIds) {
      await annotationService.removeAnnotationInfo(removedId);
    }

    const saveRes = await annotationService.registerAnnotationInfo(
      newAnnotations.map((style) => ({
        style,
        context: { text: '' },
      })),
      prop.file,
    );
    if (!saveRes.ok) console.error(saveRes.error);

    const commitRes = await annotationService.saveAnnotationInfo(prop.file);
    if (!commitRes.ok) console.error(commitRes.error);
  },
  { deep: true },
);

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
