<template>
  <v-rect ref="rectRef" :config="rectConfig" @dragend="onDragEnd" @transformend="onTransformEnd" />
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

const rectRef = ref<{ getNode: () => Konva.Rect | null } | null>(null);

const rectConfig = computed(() => {
  if (props.annotation.type !== 'box') return;
  return {
    id: props.annotation.id,
    name: 'annotation-shape',
    x: props.annotation.x,
    y: props.annotation.y,
    width: props.annotation.width ?? 0,
    height: props.annotation.height ?? 0,
    fill: 'transparent',
    stroke: props.annotation.color,
    strokeWidth: props.annotation.strokeWidth || 2,
    draggable: props.isEditing,
    opacity: props.annotation.opacity || 1,
  };
});

function getNode() {
  return rectRef.value?.getNode() ?? null;
}

defineExpose({ getNode });

function onDragEnd(e: KonvaEvent) {
  const target = e.target as Konva.Rect;
  const updatedAnnotation = {
    ...props.annotation,
    x: target.x(),
    y: target.y(),
    updatedAt: dayjs().toISOString(),
  };
  emit('update', updatedAnnotation);
}

function onTransformEnd(e: KonvaEvent) {
  const node = e.target as Konva.Rect;
  const updatedAnnotation = {
    ...props.annotation,
    x: node.x(),
    y: node.y(),
    width: Math.max(5, node.width() * node.scaleX()),
    height: Math.max(5, node.height() * node.scaleY()),
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
