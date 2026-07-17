<template>
  <!-- Group used so line and its endpoint anchors move together when dragged -->
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
      ref="lineRef"
      :config="lineConfig"
      @mouseenter="onMouseEnter"
      @mouseleave="onMouseLeave"
    />

    <!-- Endpoint anchors: shown only when the annotation is selected for editing -->
    <template v-if="props.isEditing && props.isSelected">
      <v-rect
        ref="anchor1Ref"
        :config="anchor1Config"
        @dragstart="wrappedAnchorDragStart"
        @dragmove="onAnchorDrag0"
        @dragend="onAnchorDragEnd"
      />
      <v-rect
        ref="anchor2Ref"
        :config="anchor2Config"
        @dragstart="wrappedAnchorDragStart"
        @dragmove="onAnchorDrag1"
        @dragend="onAnchorDragEnd"
      />
    </template>
  </v-group>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type Konva from 'konva';
import type { AnnotationID, LineAnnotationStyle } from 'src/models/document/pdf';
import { useAnnotationShape } from './composables/useAnnotationShape';
import { useTwoPointAnchors } from './composables/useTwoPointAnchors';

interface Props {
  annotation: LineAnnotationStyle;
  isEditing: boolean;
  isSelected?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  update: [annotation: LineAnnotationStyle];
  delete: [id: AnnotationID];
}>();

const groupRef = ref<{ getNode: () => Konva.Group | null } | null>(null);
const lineRef = ref<{ getNode: () => Konva.Line | null } | null>(null);
const anchor1Ref = ref<{ getNode: () => Konva.Rect | null } | null>(null);
const anchor2Ref = ref<{ getNode: () => Konva.Rect | null } | null>(null);
const isHovered = ref(false);

// 関係性の検証結果（OK/NG）による表示上書き。線には塗りがないためstroke系のみ用いる
const { relationalOverride, withUpdatedTimestamp, displayAnnotation, beginInteraction, endInteraction } =
  useAnnotationShape(props);

const linePoints = computed(() => {
  const annotation = displayAnnotation.value;
  if (annotation.type !== 'line') return [0, 0, 0, 0] as const;
  if (annotation.points.length !== 4) return [0, 0, 0, 0] as const;
  return [annotation.points[0], annotation.points[1], annotation.points[2], annotation.points[3]] as const;
});

const lineConfig = computed(() => {
  const annotation = displayAnnotation.value;
  return {
    id: annotation.id,
    name: 'annotation-shape',
    points: linePoints.value,
    stroke: relationalOverride.value?.stroke ?? annotation.color,
    strokeWidth: relationalOverride.value?.strokeWidth ?? (annotation.strokeWidth || 2),
    draggable: false,
    opacity: annotation.opacity || 1,
    hitStrokeWidth: 8,
  };
});

const anchor1Config = computed(() => {
  const annotation = displayAnnotation.value;
  const points = linePoints.value;
  return {
    id: `${annotation.id}-anchor-0`,
    annotationId: annotation.id,
    x: points[0],
    y: points[1],
    width: 10,
    height: 10,
    offset: { x: 5, y: 5 },
    name: 'annotation-anchor',
    fill: '#ffffff',
    stroke: annotation.color,
    strokeWidth: 2,
    cornerRadius: 0,
    draggable: props.isEditing && !!props.isSelected,
    listening: props.isEditing && !!props.isSelected,
    cursor: props.isEditing && !!props.isSelected ? 'grab' : 'default',
  };
});

const anchor2Config = computed(() => {
  const annotation = displayAnnotation.value;
  const points = linePoints.value;
  return {
    id: `${annotation.id}-anchor-1`,
    annotationId: annotation.id,
    x: points[2],
    y: points[3],
    width: 10,
    height: 10,
    offset: { x: 5, y: 5 },
    name: 'annotation-anchor',
    fill: '#ffffff',
    stroke: annotation.color,
    strokeWidth: 2,
    cornerRadius: 0,
    draggable: props.isEditing && !!props.isSelected,
    listening: props.isEditing && !!props.isSelected,
    cursor: props.isEditing && !!props.isSelected ? 'grab' : 'default',
  };
});

function getNode() {
  // 親が Transformer を割り当てられるようにグループノードを公開します
  return groupRef.value?.getNode() ?? lineRef.value?.getNode() ?? null;
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
  const lineNode = lineRef.value?.getNode();
  if (!lineNode) {
    endInteraction();
    return;
  }

  const updated = withUpdatedTimestamp({
    points: lineNode.points() as [number, number, number, number],
    x: groupNode?.x() ?? props.annotation.x,
    y: groupNode?.y() ?? props.annotation.y,
  });
  emit('update', updated);
  endInteraction(updated);
}

const { onAnchorDragStart, onAnchorDrag0, onAnchorDrag1, onAnchorDragEnd } = useTwoPointAnchors({
  getShapeNode: () => lineRef.value?.getNode() ?? null,
  getGroupNode: () => groupRef.value?.getNode() ?? null,
  // 頂点ドラッグ確定時: emitした内容をそのままdisplayAnnotationへ反映する。
  // props.annotation（DB反映待ちでまだ古い）へ再同期すると、確定直後に一瞬古い座標へ巻き戻って見えるため
  onCommit: (points) => {
    const updated = withUpdatedTimestamp({ points });
    emit('update', updated);
    endInteraction(updated);
  },
});

// アンカードラッグ開始時もliveQueryの再emitでpropsが巻き戻らないよう、開始をuseAnnotationShapeの状態と連動させる
function wrappedAnchorDragStart(e: Konva.KonvaEventObject<MouseEvent>) {
  beginInteraction();
  onAnchorDragStart(e);
}
</script>

<style scoped lang="scss">
// Konvaコンポーネントはスタイル不要
</style>
