<template>
  <v-rect
    ref="rectRef"
    :config="rectConfig"
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
  duplicate: [annotation: AnnotationStyle];
}>();

const rectRef = ref<{ getNode: () => Konva.Rect | null } | null>(null);

const {
  relationalOverride,
  withUpdatedTimestamp,
  displayAnnotation,
  endInteraction,
  dragBoundFunc,
  beginBodyDrag,
  commitBodyDrag,
  beginTransform,
  applyCenteredCorrection,
} = useAnnotationShape(props);

const rectConfig = computed(() => {
  const annotation = displayAnnotation.value;
  if (annotation.type !== 'box') return;
  return {
    id: annotation.id,
    name: 'annotation-shape',
    x: annotation.x,
    y: annotation.y,
    width: annotation.width ?? 0,
    height: annotation.height ?? 0,
    fill: relationalOverride.value?.fill ?? 'transparent',
    stroke: relationalOverride.value?.stroke ?? annotation.color,
    strokeWidth: relationalOverride.value?.strokeWidth ?? (annotation.strokeWidth || 2),
    draggable: props.isEditing,
    dragBoundFunc,
    opacity: annotation.opacity || 1,
  };
});

function getNode() {
  return rectRef.value?.getNode() ?? null;
}

defineExpose({ getNode });

function onDragStart(e: KonvaEvent) {
  beginBodyDrag(e.target);
}

function onDragEnd(e: KonvaEvent) {
  const target = e.target;
  const result = commitBodyDrag(e, { x: target.x(), y: target.y() });
  if (result.kind === 'duplicate') emit('duplicate', result.annotation);
  else emit('update', result.annotation);
}

/**
 * 変形中の形状を制御する
 */
function syncNodeGeometry(node: Konva.Rect) {
  const nextWidth = Math.max(5, node.width() * node.scaleX());
  const nextHeight = Math.max(5, node.height() * node.scaleY());

  node.setAttrs({
    x: node.x(),
    y: node.y(),
    width: nextWidth,
    height: nextHeight,
    scaleX: 1,
    scaleY: 1,
  });

  return { width: nextWidth, height: nextHeight };
}

function onTransformStart(e: KonvaEvent) {
  const node = e.target as Konva.Rect;
  beginTransform({ x: node.x(), y: node.y(), width: node.width(), height: node.height() });
}

function onTransform(e: KonvaEvent) {
  const node = e.target as Konva.Rect;
  const { width, height } = syncNodeGeometry(node);
  applyCenteredCorrection(node, { width, height });
}

function onTransformEnd(e: KonvaEvent) {
  const node = e.target as Konva.Rect;
  const { width, height } = syncNodeGeometry(node);
  applyCenteredCorrection(node, { width, height });

  const updated = withUpdatedTimestamp({ x: node.x(), y: node.y(), width, height });
  emit('update', updated);
  endInteraction(updated);
}
</script>

<style scoped lang="scss">
// Konvaコンポーネントはスタイル不要
</style>
