<template>
  <div class="page-wrapper">
    <canvas ref="canvasRef" class="pdf-canvas" />
    <!-- Konvaアノテーションレイヤー -->
    <AnnotationLayer
      v-if="canvasRendered"
      :annotations="currentPageAnnotations"
      v-model:page="page"
      v-model:scale="scale"
      v-model:canvas-size="canvasSize"
      @register-annot="onRegisterAnnot"
      @remove-annot="onRemoveAnnot"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue';
import AnnotationLayer from './Annotation/AnnotationLayer.vue';
import { debounce, useQuasar } from 'quasar';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf.js';

interface Props {
  annotations: AnnotationStyle[];
  onRender: (pageNumber: number, canvas: HTMLCanvasElement, scale: number) => Promise<void>;
  onRegisterAnnot: (annot: AnnotationStyle) => Promise<void>;
  onRemoveAnnot: (annotID: AnnotationID) => Promise<void>;
}
const props = defineProps<Props>();
const page = defineModel<number>('page', { required: true });
const scale = defineModel<number>('scale', { required: true });

const $q = useQuasar();

const canvas = useTemplateRef('canvasRef');
const canvasRendered = ref(false);
const canvasSize = ref({ width: 0, height: 0, scaleX: 1, scaleY: 1 });

const currentPageAnnotations = computed(() => {
  return props.annotations.filter((a) => a.pageNumber === page.value);
});

async function render(scale: number) {
  if (canvas.value === null) return;
  await props.onRender(page.value, canvas.value, scale);
  canvasSize.value = {
    width: canvas.value.width,
    height: canvas.value.height,
    scaleX: scale,
    scaleY: scale,
  };
}

onMounted(async () => {
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

const debouncedRender = debounce((s: number) => void render(s), 100);
watch(scale, (s) => debouncedRender(s));
watch(page, () => void render(scale.value));
</script>

<style lang="scss" scoped>
.pdf-canvas {
  display: block;
  background: white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.page-wrapper {
  position: relative;
}
</style>
