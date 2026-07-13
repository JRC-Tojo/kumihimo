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

      <!-- 連続表示 -->
      <div v-if="viewMode === 'continuousSingle'" class="continuous-pages">
        <div v-for="page in pageCount" :key="page" class="q-mb-md continuous-page-wrapper">
          <div
            :class="['continuous-page', { active: page === currentPage }]"
            :ref="
              (el) => {
                if (el) pageRefs[page - 1] = el as HTMLElement;
              }
            "
          >
            <PdfPage
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
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';
import PdfPage from 'src/components/Viewer/PdfPage.vue';
import type { ViewMode } from 'src/models/docPage';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import { useBackendApi } from 'src/apis/backendApi';
import type { ContainerElementFile } from 'src/models/container';

type RenderFunc = (pageNumber: number, canvas: HTMLCanvasElement, scale: number) => Promise<void>;
interface Prop {
  pageCount: number;
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
  void prop.onScrollToCurrentPage(viewerContainer.value?.getBoundingClientRect().height ?? 0);
});

watch(
  () => prop.viewMode,
  () => {
    if (prop.viewMode === 'continuousSingle') {
      void nextTick(() => {
        void prop.onScrollToCurrentPage(viewerContainer.value?.getBoundingClientRect().height ?? 0);
      });
    }
  },
);
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
