<template>
  <svg viewBox="0 0 24 24" class="annotation-preset-preview" aria-hidden="true">
    <!-- box -->
    <rect
      v-if="annotationStyle.type === 'box'"
      x="3"
      y="5"
      width="18"
      height="14"
      rx="2"
      :fill="fillValue"
      :fill-opacity="fillOpacityValue"
      :stroke="annotationStyle.strokeColor"
      :stroke-width="previewStrokeWidth"
      :stroke-dasharray="previewDash"
    />

    <!-- circle -->
    <ellipse
      v-else-if="annotationStyle.type === 'circle'"
      cx="12"
      cy="12"
      rx="9"
      ry="7"
      :fill="fillValue"
      :fill-opacity="fillOpacityValue"
      :stroke="annotationStyle.strokeColor"
      :stroke-width="previewStrokeWidth"
      :stroke-dasharray="previewDash"
    />

    <!-- polygon -->
    <polygon
      v-else-if="annotationStyle.type === 'polygon'"
      points="12,4 21,19 3,19"
      :fill="fillValue"
      :fill-opacity="fillOpacityValue"
      :stroke="annotationStyle.strokeColor"
      :stroke-width="previewStrokeWidth"
      :stroke-dasharray="previewDash"
    />

    <!-- line -->
    <line
      v-else-if="annotationStyle.type === 'line'"
      x1="3"
      y1="19"
      x2="21"
      y2="5"
      :stroke="annotationStyle.strokeColor"
      :stroke-width="previewStrokeWidth"
      :stroke-dasharray="previewDash"
      stroke-linecap="round"
    />

    <!-- arrow / polyline: 共通で矢じり形状を描画する -->
    <g v-else-if="annotationStyle.type === 'arrow' || annotationStyle.type === 'polyline'">
      <line
        x1="4"
        y1="18"
        x2="18"
        y2="6"
        :stroke="annotationStyle.strokeColor"
        :stroke-width="previewStrokeWidth"
        :stroke-dasharray="previewDash"
        stroke-linecap="round"
      />
      <path
        v-if="annotationStyle.endHead === 'triangle'"
        d="M18,6 L13,7.5 L16.5,10.5 Z"
        :fill="annotationStyle.strokeColor"
      />
      <path
        v-else-if="annotationStyle.endHead === 'open'"
        d="M13,7 L18,6 L16.5,11"
        fill="none"
        :stroke="annotationStyle.strokeColor"
        :stroke-width="previewStrokeWidth"
      />
      <path
        v-if="annotationStyle.startHead === 'triangle'"
        d="M4,18 L9,16.5 L5.5,13.5 Z"
        :fill="annotationStyle.strokeColor"
      />
      <path
        v-else-if="annotationStyle.startHead === 'open'"
        d="M9,17 L4,18 L5.5,13"
        fill="none"
        :stroke="annotationStyle.strokeColor"
        :stroke-width="previewStrokeWidth"
      />
    </g>

    <!-- text -->
    <g v-else-if="annotationStyle.type === 'text'">
      <rect
        v-if="annotationStyle.fillPattern !== 'none' && annotationStyle.fillColor"
        x="2"
        y="4"
        width="20"
        height="16"
        rx="2"
        :fill="annotationStyle.fillColor"
        :fill-opacity="annotationStyle.fillOpacity"
      />
      <text
        x="12"
        y="17"
        text-anchor="middle"
        :fill="annotationStyle.textColor"
        :font-weight="annotationStyle.fontWeight"
        font-size="14"
        font-family="sans-serif"
      >
        A
      </text>
    </g>
  </svg>
</template>

<script setup lang="ts">
/**
 * アノテーションプリセットの設定内容（色・線幅・線種・塗り等）を反映した小さなSVGプレビュー
 *
 * プリセットバー（AnnotationPresetBar.vue）のボタンアイコンとして使う。汎用アイコンではなく
 * 実際のスタイル値を視覚化することで、見た目だけでプリセットの内容が判別できるようにする
 */
import { computed } from 'vue';
import type { DrawingAnnotationStyle } from 'src/models/docPage';
import { strokeTypeToPreviewDash } from 'src/utils/document/strokeDashPreview';

interface Props {
  annotationStyle: DrawingAnnotationStyle;
}
const props = defineProps<Props>();

/** アイコン内で見やすいようクランプした線幅（実際のstrokeWidthはpx単位が大きく、小さいSVGでは太すぎるため） */
const previewStrokeWidth = computed(() =>
  Math.min(4, Math.max(1.2, props.annotationStyle.strokeWidth / 2)),
);

const previewDash = computed(() => strokeTypeToPreviewDash(props.annotationStyle.strokeType));

/** box/circle/polygonの塗り色。fillPatternが'none'の場合は塗らない */
const fillValue = computed(() => {
  const style = props.annotationStyle;
  if (style.type !== 'box' && style.type !== 'circle' && style.type !== 'polygon') return 'none';
  return style.fillPattern !== 'none' && style.fillColor ? style.fillColor : 'none';
});

const fillOpacityValue = computed(() => {
  const style = props.annotationStyle;
  if (style.type !== 'box' && style.type !== 'circle' && style.type !== 'polygon') return 1;
  return style.fillOpacity;
});
</script>

<style scoped lang="scss">
.annotation-preset-preview {
  width: 22px;
  height: 22px;
  display: block;
}
</style>
