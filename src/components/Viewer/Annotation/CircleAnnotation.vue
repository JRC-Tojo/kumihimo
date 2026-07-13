<template>
  <v-circle
    ref="circleRef"
    :config="circleConfig"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
    @dragend="onDragEnd"
    @transform="onTransform"
    @transformend="onTransformEnd"
  />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type Konva from 'konva';
import dayjs from 'dayjs';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import { useRelationalStore } from 'src/stores/relationalStore';
import { useSettingsStore } from 'src/stores/settingsStore';
import { getRelationalStyleOverride } from './relationalStyleOverride';

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

const relationalStore = useRelationalStore();
const settingsStore = useSettingsStore();

const circleRef = ref<{ getNode: () => Konva.Circle | null } | null>(null);
const isHovered = ref(false);

// 関係性の検証結果（OK/NG）による表示上書き。関連なし・検証保留中は元のスタイルを維持する
const relationalOverride = computed(() =>
  getRelationalStyleOverride(
    relationalStore.statusForAnnotation(props.annotation.id),
    settingsStore.relationalVerificationStyle,
  ),
);

const circleConfig = computed(() => {
  if (props.annotation.type !== 'circle') return;
  return {
    id: props.annotation.id,
    name: 'annotation-shape',
    x: props.annotation.x,
    y: props.annotation.y,
    radius: props.annotation.radius || 20,
    fill: relationalOverride.value?.fill ?? 'transparent',
    stroke: relationalOverride.value?.stroke ?? props.annotation.color,
    strokeWidth: relationalOverride.value?.strokeWidth ?? (props.annotation.strokeWidth || 2),
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

  const updatedAnnotation = {
    ...props.annotation,
    x: node.x(),
    y: node.y(),
    radius: node.radius(),
    updatedAt: dayjs().toISOString(),
  };
  emit('update', updatedAnnotation);
}
</script>

<style scoped lang="scss">
// Konvaコンポーネントはスタイル不要
</style>
