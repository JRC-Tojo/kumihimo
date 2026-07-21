<template>
  <!-- outerはレイアウト上占有するスペース（実際のズーム倍率での見た目サイズ）を確保する。
       innerは常に固定のRENDER_SCALEでレンダリングした解像度のサイズのまま、CSS transformで
       見た目上だけscaleに引き伸ばす・縮める。Konvaはtransformを適用したDOM上の
       getBoundingClientRect比率からポインタ座標を自動補正するため、この二重構造でも
       アノテーションの当たり判定はズレない -->
  <div class="page-outer" :style="outerStyle">
    <div class="page-wrapper" :style="innerStyle">
      <canvas ref="canvasRef" class="pdf-canvas" />
      <!-- Konvaアノテーションレイヤー -->
      <AnnotationLayer
        v-if="canvasRendered"
        :annotations="currentPageAnnotations"
        :scale="RENDER_SCALE"
        v-model:selected-annot-ids="selectedAnnotIds"
        v-model:page="page"
        v-model:canvas-size="canvasSize"
        @register-annot="onRegisterAnnot"
        @remove-annot="onRemoveAnnot"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue';
import AnnotationLayer from './Annotation/AnnotationLayer.vue';
import { useQuasar } from 'quasar';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf.js';
import type { PageSize } from './pdfManager';

interface Props {
  annotations: AnnotationStyle[];
  onRender: (pageNumber: number, canvas: HTMLCanvasElement, scale: number) => Promise<PageSize>;
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
// 実際にラスタライズしたレイアウトサイズ（CSS px、devicePixelRatio適用前、RENDER_SCALE基準）
const layoutSize = ref<PageSize>({ width: 0, height: 0 });

/**
 * 実際にPDFをラスタライズする固定スケール。ズーム倍率（scale）が変化しても再描画は一切行わず、
 * 常にこの解像度でラスタライズした内容を`cssZoomFactor`によるCSS transformで拡大・縮小して
 * 見た目上のズームを実現する（ページ切り替え時のみ再描画する）。
 * こうすることで、ズーム操作のたびにcanvas・Konva Stageの内部ピクセルバッファを作り直す
 * コストを完全に無くし、かつ1ページあたりのメモリ使用量をズーム倍率によらず一定に保てる
 */
const RENDER_SCALE = 5;
// ラスタライズ済みの内容を、CSS transformで実際のズーム倍率まで拡大・縮小する係数
const cssZoomFactor = computed(() => scale.value / RENDER_SCALE);

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

async function render(targetRenderScale: number) {
  if (canvas.value === null) return;
  layoutSize.value = await props.onRender(page.value, canvas.value, targetRenderScale);
  canvasSize.value = {
    width: canvas.value.width,
    height: canvas.value.height,
    scaleX: targetRenderScale,
    scaleY: targetRenderScale,
  };
}

onMounted(async () => {
  try {
    await render(RENDER_SCALE);
    canvasRendered.value = true;
  } catch (error) {
    $q.notify({
      type: 'negative',
      message: `ページのレンダリングに失敗しました: ${error instanceof Error ? error.message : 'Unknown error'}`,
      position: 'top',
    });
  }
});

// ズーム倍率（scale）の変化ではCSS transformのみで見た目を更新し、再描画は発生させない。
// ページ切り替え時のみラスタライズし直す
watch(page, () => void render(RENDER_SCALE));
</script>

<style lang="scss" scoped>
.pdf-canvas {
  display: block;
  background: white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.page-outer {
  position: relative;
  // 端数の丸め誤差でtransform後のサイズがわずかに外周をはみ出す場合に備えてクリップする
  overflow: hidden;
}

.page-wrapper {
  position: relative;
}
</style>
