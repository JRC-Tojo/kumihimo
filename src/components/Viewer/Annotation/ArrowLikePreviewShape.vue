<template>
  <v-group :config="{ x: config.x ?? 0, y: config.y ?? 0, listening: false }">
    <v-line :config="shaftConfig" />
    <v-circle v-if="startHead?.type === 'circle'" :config="startHead.config" />
    <v-line v-else-if="startHead" :config="startHead.config" />
    <v-circle v-if="endHead?.type === 'circle'" :config="endHead.config" />
    <v-line v-else-if="endHead" :config="endHead.config" />
  </v-group>
</template>

<script setup lang="ts">
/**
 * arrow/polylineの描画中プレビュー専用の表示コンポーネント（編集・ドラッグ機能は持たない）
 *
 * ArrowAnnotation.vue/PolylineAnnotation.vueと同じシャフト＋矢じりの合成描画ロジックを、
 * まだ確定していないプレビュー用のconfig（`annotationGeometry.ts`のpreviewFromPoints戻り値）から
 * 組み立てる。KonvaネイティブのArrowでは両端で独立した矢じり形状を表現できないため、
 * 実際の描画コンポーネントと同様に手動でシャフト・矢じりを合成する
 */
import { computed, type ComputedRef } from 'vue';
import type { ArrowHeadType } from 'src/models/document/pdf';
import {
  computeHeadTransform,
  getHeadLocalPoints,
  getHeadRadius,
  isClosedHead,
  isFilledHead,
} from './arrowHeadGeometry';

interface PreviewConfig {
  x?: number;
  y?: number;
  points: number[];
  stroke?: string;
  strokeWidth?: number;
  dash?: number[];
  startHead?: ArrowHeadType;
  endHead?: ArrowHeadType;
  headSize?: number;
}

interface Props {
  config: PreviewConfig;
}
const props = defineProps<Props>();

const shaftConfig = computed(() => ({
  points: props.config.points,
  stroke: props.config.stroke,
  strokeWidth: props.config.strokeWidth,
  dash: props.config.dash,
  listening: false,
}));

interface ArrowHeadRenderInfo {
  type: ArrowHeadType;
  config: Record<string, unknown>;
}

function buildHeadInfo(end: 'start' | 'end'): ComputedRef<ArrowHeadRenderInfo | null> {
  return computed(() => {
    const headType = end === 'start' ? props.config.startHead : props.config.endHead;
    if (!headType || headType === 'none') return null;

    const transform = computeHeadTransform(props.config.points, end);
    if (!transform) return null;

    const headSize = props.config.headSize ?? 10;
    const base = {
      x: transform.tipX,
      y: transform.tipY,
      rotation: transform.angleDeg,
      stroke: props.config.stroke,
      strokeWidth: props.config.strokeWidth,
      fill: props.config.stroke,
      fillEnabled: isFilledHead(headType),
      listening: false,
    };

    if (headType === 'circle') {
      return {
        type: headType,
        config: { ...base, radius: getHeadRadius(headType, headSize) ?? 0 },
      };
    }
    const points = getHeadLocalPoints(headType, headSize);
    if (!points) return null;
    return { type: headType, config: { ...base, points, closed: isClosedHead(headType) } };
  });
}

const startHead = buildHeadInfo('start');
const endHead = buildHeadInfo('end');
</script>
