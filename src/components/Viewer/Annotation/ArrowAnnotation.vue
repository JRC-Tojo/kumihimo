<template>
  <!-- lineと同様、グループにまとめることで矢印本体とアンカーが一緒にドラッグされるようにする -->
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
    <v-arrow
      ref="arrowRef"
      :config="arrowConfig"
      @mouseenter="onMouseEnter"
      @mouseleave="onMouseLeave"
    />

    <!-- 端点アンカー: 選択されて編集中の場合のみ表示 -->
    <template v-if="props.isEditing && props.isSelected">
      <v-rect
        ref="anchor1Ref"
        :config="anchor1Config"
        @dragstart="onAnchorDragStart"
        @dragmove="onAnchorDrag0"
        @dragend="onAnchorDragEnd"
      />
      <v-rect
        ref="anchor2Ref"
        :config="anchor2Config"
        @dragstart="onAnchorDragStart"
        @dragmove="onAnchorDrag1"
        @dragend="onAnchorDragEnd"
      />
    </template>
  </v-group>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type Konva from 'konva';
import type { AnnotationID, ArrowAnnotationStyle } from 'src/models/document/pdf';
import { useAnnotationShape } from './composables/useAnnotationShape';
import { useTwoPointAnchors } from './composables/useTwoPointAnchors';

interface Props {
  annotation: ArrowAnnotationStyle;
  isEditing: boolean;
  isSelected?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  update: [annotation: ArrowAnnotationStyle];
  delete: [id: AnnotationID];
}>();

const groupRef = ref<{ getNode: () => Konva.Group | null } | null>(null);
const arrowRef = ref<{ getNode: () => Konva.Arrow | null } | null>(null);
const anchor1Ref = ref<{ getNode: () => Konva.Rect | null } | null>(null);
const anchor2Ref = ref<{ getNode: () => Konva.Rect | null } | null>(null);
const isHovered = ref(false);

const { relationalOverride, withUpdatedTimestamp } = useAnnotationShape(props);

const arrowPoints = computed(() => {
  if (props.annotation.points.length !== 4) return [0, 0, 0, 0] as const;
  return [
    props.annotation.points[0],
    props.annotation.points[1],
    props.annotation.points[2],
    props.annotation.points[3],
  ] as const;
});

const arrowConfig = computed(() => {
  const headSize = props.annotation.headSize ?? 10;
  return {
    id: props.annotation.id,
    name: 'annotation-shape',
    points: arrowPoints.value,
    stroke: relationalOverride.value?.stroke ?? props.annotation.color,
    strokeWidth: relationalOverride.value?.strokeWidth ?? (props.annotation.strokeWidth || 2),
    fill: relationalOverride.value?.stroke ?? props.annotation.color,
    // KonvaのArrowは矢じりの塗りつぶし可否を始点・終点で共通のフラグしか持たないため、
    // 片方でも'open'が指定されていればアウトラインのみの矢じりとして描画する
    fillEnabled: props.annotation.startHead !== 'open' && props.annotation.endHead !== 'open',
    pointerAtBeginning: props.annotation.startHead !== 'none',
    pointerAtEnding: props.annotation.endHead !== 'none',
    pointerLength: headSize,
    pointerWidth: headSize,
    draggable: false,
    opacity: props.annotation.opacity || 1,
    hitStrokeWidth: 8,
  };
});

const anchor1Config = computed(() => {
  const points = arrowPoints.value;
  return {
    id: `${props.annotation.id}-anchor-0`,
    annotationId: props.annotation.id,
    x: points[0],
    y: points[1],
    width: 10,
    height: 10,
    offset: { x: 5, y: 5 },
    name: 'annotation-anchor',
    fill: '#ffffff',
    stroke: props.annotation.color,
    strokeWidth: 2,
    cornerRadius: 0,
    draggable: props.isEditing && !!props.isSelected,
    listening: props.isEditing && !!props.isSelected,
    cursor: props.isEditing && !!props.isSelected ? 'grab' : 'default',
  };
});

const anchor2Config = computed(() => {
  const points = arrowPoints.value;
  return {
    id: `${props.annotation.id}-anchor-1`,
    annotationId: props.annotation.id,
    x: points[2],
    y: points[3],
    width: 10,
    height: 10,
    offset: { x: 5, y: 5 },
    name: 'annotation-anchor',
    fill: '#ffffff',
    stroke: props.annotation.color,
    strokeWidth: 2,
    cornerRadius: 0,
    draggable: props.isEditing && !!props.isSelected,
    listening: props.isEditing && !!props.isSelected,
    cursor: props.isEditing && !!props.isSelected ? 'grab' : 'default',
  };
});

function getNode() {
  // 親がTransformerを割り当てられるようにグループノードを公開する（矢印は個別アンカー編集のため実際には未使用）
  return groupRef.value?.getNode() ?? arrowRef.value?.getNode() ?? null;
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
  const arrowNode = arrowRef.value?.getNode();
  if (!arrowNode) return;

  emit(
    'update',
    withUpdatedTimestamp({
      points: arrowNode.points() as [number, number, number, number],
      x: groupNode?.x() ?? props.annotation.x,
      y: groupNode?.y() ?? props.annotation.y,
    }),
  );
}

const { onAnchorDragStart, onAnchorDrag0, onAnchorDrag1, onAnchorDragEnd } = useTwoPointAnchors({
  getShapeNode: () => arrowRef.value?.getNode() ?? null,
  getGroupNode: () => groupRef.value?.getNode() ?? null,
  onCommit: (points) => emit('update', withUpdatedTimestamp({ points })),
});
</script>

<style scoped lang="scss">
// Konvaコンポーネントはスタイル不要
</style>
