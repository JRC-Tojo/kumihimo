<template>
  <svg viewBox="0 0 24 24" class="annotation-preset-preview" aria-hidden="true">
    <!-- ダークモードでも線色・文字色（黒等）が見えなくならないよう、常に明るい背景チップの上に描画する -->
    <rect x="0.5" y="0.5" width="23" height="23" rx="4" class="preview-backdrop" />

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
    />

    <!-- arrow / polyline: 共通で矢じり形状を描画する -->
    <g v-else-if="annotationStyle.type === 'arrow' || annotationStyle.type === 'polyline'">
      <!--
        stroke-linecapは意図的に既定値（butt）のままにしている。'round'にすると、
        線幅に対して破線・点線の間隔が近い場合に丸められた線端が隙間を埋めてしまい、
        実線とほぼ見分けがつかなくなってしまう（StrokeTypePreview.vueと同じ理由）
      -->
      <line
        x1="4"
        y1="18"
        x2="18"
        y2="6"
        :stroke="annotationStyle.strokeColor"
        :stroke-width="previewStrokeWidth"
        :stroke-dasharray="previewDash"
      />
      <g v-if="endHeadRender" :transform="endHeadRender.transform">
        <path
          v-if="endHeadRender.path"
          :d="endHeadRender.path"
          :fill="endHeadRender.filled ? annotationStyle.strokeColor : 'none'"
          :stroke="annotationStyle.strokeColor"
          stroke-width="1"
        />
        <circle
          v-else-if="endHeadRender.radius"
          cx="0"
          cy="0"
          :r="endHeadRender.radius"
          :fill="endHeadRender.filled ? annotationStyle.strokeColor : 'none'"
          :stroke="annotationStyle.strokeColor"
          stroke-width="1"
        />
      </g>
      <g v-if="startHeadRender" :transform="startHeadRender.transform">
        <path
          v-if="startHeadRender.path"
          :d="startHeadRender.path"
          :fill="startHeadRender.filled ? annotationStyle.strokeColor : 'none'"
          :stroke="annotationStyle.strokeColor"
          stroke-width="1"
        />
        <circle
          v-else-if="startHeadRender.radius"
          cx="0"
          cy="0"
          :r="startHeadRender.radius"
          :fill="startHeadRender.filled ? annotationStyle.strokeColor : 'none'"
          :stroke="annotationStyle.strokeColor"
          stroke-width="1"
        />
      </g>
    </g>

    <!-- text -->
    <g v-else-if="annotationStyle.type === 'text'">
      <rect
        x="2"
        y="2"
        width="20"
        height="20"
        rx="2"
        :fill="fillValue"
        :fill-opacity="fillOpacityValue"
        :stroke="annotationStyle.strokeColor"
        :stroke-width="previewStrokeWidth"
        :stroke-dasharray="previewDash"
      />
      <text
        x="12"
        y="17"
        text-anchor="middle"
        :fill="annotationStyle.textColor"
        :font-weight="annotationStyle.fontWeight"
        font-size="14"
        :font-family="annotationStyle.fontFamily"
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
import {
  buildHeadLocalSvgPath,
  computeHeadTransform,
  getHeadRadius,
  isFilledHead,
} from 'src/components/Viewer/Annotation/arrowHeadGeometry';

interface Props {
  annotationStyle: DrawingAnnotationStyle;
}
const props = defineProps<Props>();

// このプレビュー内でarrow/polylineのシャフトとして描く固定の線分（下記<line>と同じ座標）
const ARROW_PREVIEW_POINTS = [4, 18, 18, 6];
// reverseOpen/reverseTriangleは先端がtipからさらに外側（size分）へ突き出すため、
// viewBox(0 0 24 24)から見切れないよう小さめに固定する
const PREVIEW_HEAD_SIZE = 3;

interface HeadRender {
  transform: string;
  path: string | null;
  radius: number | null;
  filled: boolean;
}

/**
 * 矢じり（始点/終点）のミニプレビュー描画情報を組み立てる。実際の描画
 * （ArrowAnnotation.vue等）と同じarrowHeadGeometry.tsのジオメトリ計算を使うことで、
 * 見た目のズレが生じないようにする
 */
function buildHeadRender(end: 'start' | 'end'): HeadRender | null {
  const style = props.annotationStyle;
  if (style.type !== 'arrow' && style.type !== 'polyline') return null;
  const headType = end === 'start' ? style.startHead : style.endHead;
  if (headType === 'none') return null;

  const transform = computeHeadTransform(ARROW_PREVIEW_POINTS, end);
  if (!transform) return null;

  return {
    transform: `translate(${transform.tipX},${transform.tipY}) rotate(${transform.angleDeg})`,
    path: buildHeadLocalSvgPath(headType, PREVIEW_HEAD_SIZE),
    radius: getHeadRadius(headType, PREVIEW_HEAD_SIZE),
    filled: isFilledHead(headType),
  };
}

const startHeadRender = computed(() => buildHeadRender('start'));
const endHeadRender = computed(() => buildHeadRender('end'));

/** アイコン内で見やすいようクランプした線幅（実際のstrokeWidthはpx単位が大きく、小さいSVGでは太すぎるため） */
const previewStrokeWidth = computed(() =>
  Math.min(4, Math.max(1.2, props.annotationStyle.strokeWidth / 2)),
);

const previewDash = computed(() => strokeTypeToPreviewDash(props.annotationStyle.strokeType));

/** box/circle/polygon/textの塗り色。fillPatternが'none'の場合は塗らない */
const fillValue = computed(() => {
  const style = props.annotationStyle;
  if (
    style.type !== 'box' &&
    style.type !== 'circle' &&
    style.type !== 'polygon' &&
    style.type !== 'text'
  )
    return 'none';
  return style.fillPattern !== 'none' && style.fillColor ? style.fillColor : 'none';
});

const fillOpacityValue = computed(() => {
  const style = props.annotationStyle;
  if (
    style.type !== 'box' &&
    style.type !== 'circle' &&
    style.type !== 'polygon' &&
    style.type !== 'text'
  )
    return 1;
  return style.fillOpacity;
});
</script>

<style scoped lang="scss">
.annotation-preset-preview {
  width: 22px;
  height: 22px;
  display: block;
}

.preview-backdrop {
  fill: #f4f4f5;
  stroke: rgba(0, 0, 0, 0.12);
  stroke-width: 1;
}
</style>
