<template>
  <!-- ポリゴン本体と頂点アンカーが一緒にドラッグされるようグループにまとめる -->
  <v-group
    ref="groupRef"
    :config="{
      x: displayAnnotation.x,
      y: displayAnnotation.y,
      id: displayAnnotation.id,
      draggable: props.isEditing && !!props.isSelected,
      onDragstart: beginInteraction,
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
        @dragstart="wrappedAnchorDragStart"
        @dragmove="(e: Konva.KonvaEventObject<MouseEvent>) => onAnchorDrag(i, e)"
        @dragend="wrappedAnchorDragEnd"
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

const { relationalOverride, withUpdatedTimestamp, displayAnnotation, beginInteraction, endInteraction } =
  useAnnotationShape(props);

const shapeConfig = computed(() => {
  const annotation = displayAnnotation.value;
  return {
    id: annotation.id,
    name: 'annotation-shape',
    points: annotation.points,
    closed: true,
    fill: relationalOverride.value?.fill ?? 'transparent',
    stroke: relationalOverride.value?.stroke ?? annotation.color,
    strokeWidth: relationalOverride.value?.strokeWidth ?? (annotation.strokeWidth || 2),
    draggable: false,
    opacity: annotation.opacity || 1,
    // 塗りがtransparent/薄い場合でも辺をクリックで選択できるよう、当たり判定の太さを広げる（Polylineと同様）
    hitStrokeWidth: 8,
  };
});

const anchorConfigs = computed(() => {
  const annotation = displayAnnotation.value;
  return buildPointAnchorConfigs(annotation.points, annotation.color, annotation.id, props.isEditing, !!props.isSelected);
});

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
  endInteraction();
}

const { onAnchorDragStart, onAnchorDrag, onAnchorDragEnd } = useMultiPointAnchors({
  getShapeNode: () => shapeRef.value?.getNode() ?? null,
  getGroupNode: () => groupRef.value?.getNode() ?? null,
  onCommit: (points) => emit('update', withUpdatedTimestamp({ points })),
});

// 頂点ドラッグ中もliveQueryの再emitでpropsが巻き戻らないよう、開始・終了をuseAnnotationShapeの状態と連動させる
function wrappedAnchorDragStart(e: Konva.KonvaEventObject<MouseEvent>) {
  beginInteraction();
  onAnchorDragStart(e);
}

function wrappedAnchorDragEnd() {
  onAnchorDragEnd();
  endInteraction();
}
</script>

<style scoped lang="scss">
// Konvaコンポーネントはスタイル不要
</style>
