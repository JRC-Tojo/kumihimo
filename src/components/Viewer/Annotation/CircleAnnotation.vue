<template>
  <v-ellipse
    ref="ellipseRef"
    :config="ellipseConfig"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @transformstart="onTransformStart"
    @transform="onTransform"
    @transformend="onTransformEnd"
  />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type Konva from 'konva';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import { useAnnotationShape } from './composables/useAnnotationShape';

type KonvaEvent = Konva.KonvaEventObject<Event>;

interface Props {
  annotation: AnnotationStyle;
  isEditing: boolean;
  isSelected?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  update: [annotation: AnnotationStyle];
  delete: [id: AnnotationID];
}>();

const ellipseRef = ref<{ getNode: () => Konva.Ellipse | null } | null>(null);
const isHovered = ref(false);

const {
  relationalOverride,
  strokeDash,
  withUpdatedTimestamp,
  displayAnnotation,
  beginInteraction,
  endInteraction,
  ctrlKey,
  dragBoundFunc,
  beginBodyDrag,
  commitBodyDrag,
} = useAnnotationShape(props);

// 変形開始時の中心座標。Ellipseはx/yが常に中心を表すため、Box/Textとは別に中心固定補正を扱う
const transformStartCenter = ref<{ x: number; y: number } | null>(null);

const ellipseConfig = computed(() => {
  const annotation = displayAnnotation.value;
  if (annotation.type !== 'circle') return;
  return {
    id: annotation.id,
    name: 'annotation-shape',
    x: annotation.x,
    y: annotation.y,
    radiusX: annotation.radiusX ?? annotation.radius ?? 20,
    radiusY: annotation.radiusY ?? annotation.radius ?? 20,
    fill: relationalOverride.value?.fill ?? annotation.fillColor ?? 'transparent',
    stroke: relationalOverride.value?.stroke ?? annotation.color,
    strokeWidth: relationalOverride.value?.strokeWidth ?? (annotation.strokeWidth || 2),
    dash: strokeDash.value,
    draggable: props.isEditing && !ctrlKey.value,
    dragBoundFunc,
    opacity: annotation.opacity || 1,
  };
});

function getNode() {
  return ellipseRef.value?.getNode() ?? null;
}

defineExpose({ getNode });

function onMouseEnter() {
  isHovered.value = true;
}

function onMouseLeave() {
  isHovered.value = false;
}

function onDragStart(e: KonvaEvent) {
  beginBodyDrag(e.target);
}

function onDragEnd(e: KonvaEvent) {
  const target = e.target;
  emit('update', commitBodyDrag(e, { x: target.x(), y: target.y() }));
}

function onTransformStart(e: KonvaEvent) {
  const node = e.target;
  beginInteraction();
  transformStartCenter.value = { x: node.x(), y: node.y() };
}

/**
 * 変形中の形状を制御する
 *
 * Ctrlなし（既定・形状修正）: radiusX/radiusYを独立にscaleX/scaleYから算出し、楕円化を許容する。
 * 中心位置はKonvaの通常のTransformer挙動（反対側コーナー基準）に従う。
 * Ctrlあり（スケール調整）: 中心を固定したまま、両軸を同一のスケール係数で拡大縮小し、常に正円を維持する
 * （「真の拡大縮小」として一貫した挙動になる。図形の角をつかんでのdragにCtrlの有無で区別）
 */
function syncNodeGeometry(node: Konva.Ellipse) {
  const scaleX = node.scaleX();
  const scaleY = node.scaleY();

  if (ctrlKey.value && transformStartCenter.value) {
    const uniformScale = Math.max(scaleX, scaleY);
    const nextRadius = Math.max(5, Math.max(node.radiusX(), node.radiusY()) * uniformScale);
    node.setAttrs({
      x: transformStartCenter.value.x,
      y: transformStartCenter.value.y,
      radiusX: nextRadius,
      radiusY: nextRadius,
      scaleX: 1,
      scaleY: 1,
    });
    return { radiusX: nextRadius, radiusY: nextRadius };
  }

  const nextRadiusX = Math.max(5, node.radiusX() * scaleX);
  const nextRadiusY = Math.max(5, node.radiusY() * scaleY);
  node.setAttrs({
    radiusX: nextRadiusX,
    radiusY: nextRadiusY,
    scaleX: 1,
    scaleY: 1,
  });
  return { radiusX: nextRadiusX, radiusY: nextRadiusY };
}

function onTransform(e: KonvaEvent) {
  const node = e.target as Konva.Ellipse;
  syncNodeGeometry(node);
}

function onTransformEnd(e: KonvaEvent) {
  const node = e.target as Konva.Ellipse;
  const { radiusX, radiusY } = syncNodeGeometry(node);

  const updated = withUpdatedTimestamp({
    x: node.x(),
    y: node.y(),
    radiusX,
    radiusY,
    // 後方互換のため、正円時のフォールバック値としてradiusも更新しておく
    radius: Math.max(radiusX, radiusY),
  });
  emit('update', updated);
  endInteraction(updated);
}
</script>

<style scoped lang="scss">
// Konvaコンポーネントはスタイル不要
</style>
