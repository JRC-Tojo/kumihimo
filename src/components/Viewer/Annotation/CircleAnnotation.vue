<template>
  <v-circle
    ref="circleRef"
    :config="circleConfig"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
    @dragend="onDragEnd"
    @transformend="onTransformEnd"
  />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type Konva from 'konva';
import dayjs from 'dayjs';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';

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

const circleConfig = computed(() => {
  if (props.annotation.type !== 'circle') return;
  return {
    id: props.annotation.id,
    name: 'annotation-shape',
    x: props.annotation.x,
    y: props.annotation.y,
    radius: props.annotation.radius || 20,
    fill: 'transparent',
    stroke: props.annotation.color,
    strokeWidth: props.annotation.strokeWidth || 2,
    draggable: props.isEditing,
    opacity: props.annotation.opacity || 1,
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
  const updatedAnnotation = {
    ...props.annotation,
    x: target.x(),
    y: target.y(),
    updatedAt: dayjs().toISOString(),
  };
  emit('update', updatedAnnotation);
}

function onTransformEnd(e: KonvaEvent) {
  const node = e.target as Konva.Circle;
  const updatedAnnotation = {
    ...props.annotation,
    radius: Math.max(5, node.radius() * Math.max(node.scaleX(), node.scaleY())),
    updatedAt: dayjs().toISOString(),
  };
  node.scaleX(1);
  node.scaleY(1);
  emit('update', updatedAnnotation);
}
</script>

<style scoped lang="scss">
// Konvaコンポーネントはスタイル不要
</style>
