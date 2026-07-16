<template>
  <!-- ポリゴン本体と頂点アンカーが一緒にドラッグされるようグループにまとめる -->
  <v-group
    ref="groupRef"
    :config="{
      x: props.annotation.x,
      y: props.annotation.y,
      id: props.annotation.id,
      draggable: props.isEditing && !!props.isSelected,
      onDragend: onDragEnd,
    }"
  >
    <v-line
      ref="shapeRef"
      :config="shapeConfig"
      @mouseenter="onMouseEnter"
      @mouseleave="onMouseLeave"
    />

    <!-- 頂点アンカー: 選択されて編集中の場合のみ表示 -->
    <template v-if="props.isEditing && props.isSelected">
      <v-rect
        v-for="(anchor, i) in anchorConfigs"
        :key="anchor.id"
        :config="anchor"
        @dragstart="onAnchorDragStart"
        @dragmove="(e: Konva.KonvaEventObject<MouseEvent>) => onAnchorDrag(i, e)"
        @dragend="onAnchorDragEnd"
      />
    </template>
  </v-group>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type Konva from 'konva';
import type { AnnotationID, PolygonAnnotationStyle } from 'src/models/document/pdf';
import { useAnnotationShape } from './composables/useAnnotationShape';
import { useMultiPointAnchors } from './composables/useMultiPointAnchors';
import { buildPointAnchorConfigs } from './composables/multiPointAnchorConfig';

interface Props {
  annotation: PolygonAnnotationStyle;
  isEditing: boolean;
  isSelected?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  update: [annotation: PolygonAnnotationStyle];
  delete: [id: AnnotationID];
}>();

const groupRef = ref<{ getNode: () => Konva.Group | null } | null>(null);
const shapeRef = ref<{ getNode: () => Konva.Line | null } | null>(null);
const isHovered = ref(false);

const { relationalOverride, withUpdatedTimestamp } = useAnnotationShape(props);

const shapeConfig = computed(() => {
  return {
    id: props.annotation.id,
    name: 'annotation-shape',
    points: props.annotation.points,
    closed: true,
    fill: relationalOverride.value?.fill ?? 'transparent',
    stroke: relationalOverride.value?.stroke ?? props.annotation.color,
    strokeWidth: relationalOverride.value?.strokeWidth ?? (props.annotation.strokeWidth || 2),
    draggable: false,
    opacity: props.annotation.opacity || 1,
  };
});

const anchorConfigs = computed(() =>
  buildPointAnchorConfigs(
    props.annotation.points,
    props.annotation.color,
    props.annotation.id,
    props.isEditing,
    !!props.isSelected,
  ),
);

function getNode() {
  // 親がTransformerを割り当てられるようにグループノードを公開する（ポリゴンは個別アンカー編集のため実際には未使用）
  return groupRef.value?.getNode() ?? shapeRef.value?.getNode() ?? null;
}

defineExpose({ getNode });

function onMouseEnter() {
  isHovered.value = true;
}

function onMouseLeave() {
  isHovered.value = false;
}

function onDragEnd() {
  const groupNode = groupRef.value?.getNode();
  const shapeNode = shapeRef.value?.getNode();
  if (!shapeNode) return;

  emit(
    'update',
    withUpdatedTimestamp({
      points: shapeNode.points(),
      x: groupNode?.x() ?? props.annotation.x,
      y: groupNode?.y() ?? props.annotation.y,
    }),
  );
}

const { onAnchorDragStart, onAnchorDrag, onAnchorDragEnd } = useMultiPointAnchors({
  getShapeNode: () => shapeRef.value?.getNode() ?? null,
  getGroupNode: () => groupRef.value?.getNode() ?? null,
  onCommit: (points) => emit('update', withUpdatedTimestamp({ points })),
});
</script>

<style scoped lang="scss">
// Konvaコンポーネントはスタイル不要
</style>
