<template>
  <svg viewBox="0 0 28 14" class="arrow-head-preview" aria-hidden="true">
    <!-- ダークモードでも線色（黒等）が見えなくならないよう、常に明るい背景チップの上に描画する -->
    <rect x="0" y="0" width="28" height="14" rx="3" class="preview-backdrop" />

    <line x1="2" y1="7" x2="26" y2="7" :stroke="color" stroke-width="2" />
    <g v-if="path" :transform="`translate(${tipX},${tipY}) rotate(${angleDeg})`">
      <path :d="path" :fill="isFilled ? color : 'none'" :stroke="color" stroke-width="1.5" />
    </g>
    <circle
      v-else-if="radius"
      :cx="tipX"
      :cy="tipY"
      :r="radius"
      :fill="isFilled ? color : 'none'"
      :stroke="color"
      stroke-width="1.5"
    />
  </svg>
</template>

<script setup lang="ts">
/**
 * 矢じり形状（始点/終点）を示す小さなSVGプレビュー
 *
 * スタイルパネルの矢じり形状ボタン・そのドロップダウンメニューの各選択肢、
 * プリセットプレビュー（AnnotationPresetPreview.vue）で共用する。実際の描画
 * （ArrowAnnotation.vue/PolylineAnnotation.vue）と同じ`arrowHeadGeometry.ts`の
 * ジオメトリ計算を使うことで、見た目のズレが生じないようにする
 */
import { computed } from 'vue';
import type { ArrowHeadType } from 'src/models/document/pdf';
import {
  buildHeadLocalSvgPath,
  getHeadRadius,
  isFilledHead,
} from 'src/components/Viewer/Annotation/arrowHeadGeometry';

interface Props {
  headType: ArrowHeadType;
  color?: string;
  // どちら側の矢じりとしてプレビューするか（始点側は左向き、終点側は右向きに描く）
  end: 'start' | 'end';
}
const props = withDefaults(defineProps<Props>(), { color: '#000000' });

/** viewBox(28x14)の中でプレビュー線が十分見えるよう、実際の描画よりやや小さめに固定する */
const PREVIEW_HEAD_SIZE = 8;
const tipY = 7;

const tipX = computed(() => (props.end === 'end' ? 26 : 2));
// ローカル座標系は+xが外向きのため、start側（左向きに突き出す）は180度回転させる
const angleDeg = computed(() => (props.end === 'end' ? 0 : 180));

const path = computed(() => buildHeadLocalSvgPath(props.headType, PREVIEW_HEAD_SIZE));
const radius = computed(() => getHeadRadius(props.headType, PREVIEW_HEAD_SIZE));
const isFilled = computed(() => isFilledHead(props.headType));
</script>

<style scoped lang="scss">
.arrow-head-preview {
  width: 28px;
  height: 14px;
  display: block;
}

.preview-backdrop {
  fill: #f4f4f5;
  stroke: rgba(0, 0, 0, 0.12);
  stroke-width: 1;
}
</style>
