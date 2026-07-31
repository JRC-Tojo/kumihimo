<template>
  <!-- outerはレイアウト上占有するスペース（実際のズーム倍率での見た目サイズ）を確保する。
       innerは最後に実際にラスタライズした解像度（lastRenderedScale）のサイズのまま、CSS transformで
       見た目上だけscaleへ引き伸ばす・縮める。Konvaはtransformを適用したDOM上の
       getBoundingClientRect比率からポインタ座標を自動補正するため、この二重構造でも
       アノテーションの当たり判定はズレない -->
  <div class="page-outer" :style="outerStyle">
    <div class="page-wrapper" :style="innerStyle">
      <canvas ref="canvasRef" class="pdf-canvas" />
      <!-- Konvaアノテーションレイヤー -->
      <AnnotationLayer
        v-if="canvasRendered"
        :annotations="currentPageAnnotations"
        :scale="lastRenderedScale"
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
import { isRenderCancelledError } from './pdfManager';

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
// 実際にラスタライズしたレイアウトサイズ（CSS px、devicePixelRatio適用前、lastRenderedScale基準）
const layoutSize = ref<PageSize>({ width: 0, height: 0 });
// 最後に実際にラスタライズしたスケール。ズーム中はこれと`scale`の比率をCSS transformで埋める
const lastRenderedScale = ref(1);

/**
 * ズーム操作が止まってから実際に再ラスタライズするまでの待ち時間（ミリ秒）。
 * ズーム中の見た目はCSS transformのみで追従させ、操作が落ち着いた時点で
 * その時点のスケールに合わせて描き直すことで、鮮明さとメモリ・描画コストを両立する
 */
const ZOOM_RERENDER_DEBOUNCE_MS = 200;

// ラスタライズ済みの内容を、CSS transformで現在のズーム倍率まで拡大・縮小する係数。
// lastRenderedScaleとscaleが乖離するほど画質は劣化する（乖離が大きいほど、CSSでの拡大時はぼやけ、
// 縮小時は細い線がつぶれて薄く見える）ため、下のdebounce再描画で乖離を都度解消する
const cssZoomFactor = computed(() => scale.value / lastRenderedScale.value);

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

// 同じPdfPageインスタンスに対してrender()が重ねて呼ばれた場合（ズームのデバウンス再描画と
// ページ切り替えの再描画が競合するケース等）、先に呼んだ（古い）render()の完了が後から呼んだ
// （新しい）render()より遅れることがある。世代番号を使い、自分より新しいrender()呼び出しが
// 既に発行されていれば、古い結果でreactive state（layoutSize等）を上書きしないようにする
let renderGeneration = 0;

async function render(targetRenderScale: number) {
  if (canvas.value === null) return;
  const generation = ++renderGeneration;
  const result = await props.onRender(page.value, canvas.value, targetRenderScale);
  if (generation !== renderGeneration) return;

  layoutSize.value = result;
  canvasSize.value = {
    width: canvas.value.width,
    height: canvas.value.height,
    scaleX: targetRenderScale,
    scaleY: targetRenderScale,
  };
  lastRenderedScale.value = targetRenderScale;
}

/**
 * `render()`を、失敗時のユーザー通知（再試行アクション付き）まで含めて安全に呼び出す。
 *
 * `render()`はページ切り替え・ズームのデバウンス再描画から重ねて呼ばれ得るため、pdf.js側で
 * 前の呼び出しが意図的にキャンセルされる（`pdfManager.ts`の`canvasRenderTask`経由）ことがある。
 * これは実際の失敗ではないため、`isRenderCancelledError`で判別してユーザー通知は行わない
 */
async function renderSafely(targetScale: number): Promise<boolean> {
  try {
    await render(targetScale);
    return true;
  } catch (error) {
    if (isRenderCancelledError(error)) return false;
    $q.notify({
      type: 'negative',
      message: `ページのレンダリングに失敗しました: ${error instanceof Error ? error.message : 'Unknown error'}`,
      position: 'top',
      actions: [{ label: '再試行', handler: () => void renderSafely(targetScale) }],
    });
    return false;
  }
}

onMounted(async () => {
  canvasRendered.value = await renderSafely(scale.value);
});

/**
 * ズーム操作が落ち着いた時点で、その時点のスケール（上限まで）に合わせて再ラスタライズする。
 * ドラッグ・ホイール中の連続したスケール変化のたびに走らせるとメモリ・描画コストが甚大なため、
 * 一定時間操作が無かった場合にのみ発火させる（既にその解像度で描画済みなら何もしない）
 */
const debouncedRerenderForZoom = debounce(() => {
  const target = scale.value;
  if (target === lastRenderedScale.value) return;
  void renderSafely(target);
}, ZOOM_RERENDER_DEBOUNCE_MS);

watch(scale, () => debouncedRerenderForZoom());
watch(page, () => void renderSafely(scale.value));
</script>

<style lang="scss" scoped>
.pdf-canvas {
  display: block;
  background: white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  image-rendering: pixelated;
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
