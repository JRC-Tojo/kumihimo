<template>
  <!-- outerはレイアウト上占有するスペース（実際のズーム倍率での見た目サイズ）を確保する。
       innerは実際にレンダリングした解像度（renderScale基準）のサイズのまま、CSS transformで
       見た目上だけscaleに引き伸ばす。Konvaはtransformを適用したDOM上のgetBoundingClientRect比率から
       ポインタ座標を自動補正するため、この二重構造でもアノテーションの当たり判定はズレない -->
  <div class="page-outer" :style="outerStyle">
    <div class="page-wrapper" :style="innerStyle">
      <canvas ref="canvasRef" class="pdf-canvas" />
      <!-- Konvaアノテーションレイヤー -->
      <AnnotationLayer
        v-if="canvasRendered"
        :annotations="currentPageAnnotations"
        :scale="renderScale"
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
import { debounce, useQuasar } from 'quasar';
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
// 実際にラスタライズしたレイアウトサイズ（CSS px、devicePixelRatio適用前、renderScale基準）
const layoutSize = ref<PageSize>({ width: 0, height: 0 });

/**
 * 実際にPDFをラスタライズする上限スケール。ズームがこれを超えても再描画はせず、
 * `cssZoomFactor`によるCSS transformの拡大で見た目上のズームだけを実現する。
 * これにより高倍率ズーム時にcanvas・Konva Stageの内部ピクセルバッファが際限なく
 * 肥大化するのを防ぐ（拡大表示された分だけぼやけるが、実用上200%までは鮮明に保たれる）
 */
const RENDER_SCALE_CAP = 2;
const renderScale = computed(() => Math.min(scale.value, RENDER_SCALE_CAP));
// renderScaleでラスタライズした内容を、CSS transformで実際のズーム倍率まで拡大する係数（1以上）
const cssZoomFactor = computed(() => scale.value / renderScale.value);

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
    await render(renderScale.value);
    canvasRendered.value = true;
  } catch (error) {
    $q.notify({
      type: 'negative',
      message: `ページのレンダリングに失敗しました: ${error instanceof Error ? error.message : 'Unknown error'}`,
      position: 'top',
    });
  }
});

// renderScaleの変化（＝実際に再ラスタライズが必要な変化）にのみ反応する。cssZoomFactorのみが
// 変化するズーム（RENDER_SCALE_CAPを超えた範囲）はCSS transformで即座に反映されるため、
// 重い再描画をトリガーしない
const debouncedRender = debounce((s: number) => void render(s), 100);
watch(renderScale, (s) => debouncedRender(s));
watch(page, () => void render(renderScale.value));
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
