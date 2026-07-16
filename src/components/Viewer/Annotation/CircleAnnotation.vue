<template>
  <v-circle
    ref="circleRef"
    :config="circleConfig"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
    @dragstart="beginInteraction"
    @dragend="onDragEnd"
    @transformstart="beginInteraction"
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

const circleRef = ref<{ getNode: () => Konva.Circle | null } | null>(null);
const isHovered = ref(false);

const { relationalOverride, withUpdatedTimestamp, displayAnnotation, beginInteraction, endInteraction } =
  useAnnotationShape(props);

const circleConfig = computed(() => {
  const annotation = displayAnnotation.value;
  if (annotation.type !== 'circle') return;
  return {
    id: annotation.id,
    name: 'annotation-shape',
    x: annotation.x,
    y: annotation.y,
    radius: annotation.radius || 20,
    fill: relationalOverride.value?.fill ?? 'transparent',
    stroke: relationalOverride.value?.stroke ?? annotation.color,
    strokeWidth: relationalOverride.value?.strokeWidth ?? (annotation.strokeWidth || 2),
    draggable: props.isEditing,
    opacity: annotation.opacity || 1,
  };
});

function getNode() {
  return circleRef.value?.getNode() ?? null;
}

defineExpose({ getNode });

function onMouseEnter() {
  isHovered.value = true;
}

function onMouseLeave() {
  isHovered.value = false;
}

function onDragEnd(e: KonvaEvent) {
  const target = e.target as Konva.Circle;
  emit('update', withUpdatedTimestamp({ x: target.x(), y: target.y() }));
  endInteraction();
}

function syncNodeGeometry(node: Konva.Circle) {
  const nextRadius = Math.max(5, node.radius() * Math.max(node.scaleX(), node.scaleY()));

  node.setAttrs({
    x: node.x(),
    y: node.y(),
    radius: nextRadius,
    scaleX: 1,
    scaleY: 1,
  });
}

function onTransform(e: KonvaEvent) {
  const node = e.target as Konva.Circle;
  syncNodeGeometry(node);
}

function onTransformEnd(e: KonvaEvent) {
  const node = e.target as Konva.Circle;
  syncNodeGeometry(node);

  emit('update', withUpdatedTimestamp({ x: node.x(), y: node.y(), radius: node.radius() }));
  endInteraction();
}
</script>

<style scoped lang="scss">
// Konvaコンポーネントはスタイル不要
</style>
