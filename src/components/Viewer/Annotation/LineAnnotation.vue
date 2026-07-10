<template>
  <!-- Group used so line and its endpoint anchors move together when dragged -->
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
import dayjs from 'dayjs';
import type { AnnotationID, LineAnnotationStyle } from 'src/models/document/pdf';
import { useRelationalStore } from 'src/stores/relationalStore';
import { useSettingsStore } from 'src/stores/settingsStore';
import { getRelationalStyleOverride } from './relationalStyleOverride';

type KonvaEvent = Konva.KonvaEventObject<MouseEvent>;

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

const relationalStore = useRelationalStore();
const settingsStore = useSettingsStore();

const groupRef = ref<{ getNode: () => Konva.Group | null } | null>(null);
const lineRef = ref<{ getNode: () => Konva.Line | null } | null>(null);
const anchor1Ref = ref<{ getNode: () => Konva.Rect | null } | null>(null);
const anchor2Ref = ref<{ getNode: () => Konva.Rect | null } | null>(null);
const isHovered = ref(false);

// 関係性の検証結果（OK/NG）による表示上書き。線には塗りがないためstroke系のみ用いる
const relationalOverride = computed(() =>
  getRelationalStyleOverride(
    relationalStore.statusForAnnotation(props.annotation.id),
    settingsStore.relationalVerificationStyle,
  ),
);

const linePoints = computed(() => {
  if (props.annotation.type !== 'line') return [0, 0, 0, 0] as const;
  if (props.annotation.points.length !== 4) return [0, 0, 0, 0] as const;
  return [
    props.annotation.points[0],
    props.annotation.points[1],
    props.annotation.points[2],
    props.annotation.points[3],
  ] as const;
});

const lineConfig = computed(() => {
  return {
    id: props.annotation.id,
    name: 'annotation-shape',
    points: linePoints.value,
    stroke: relationalOverride.value?.stroke ?? props.annotation.color,
    strokeWidth: relationalOverride.value?.strokeWidth ?? (props.annotation.strokeWidth || 2),
    draggable: false,
    opacity: props.annotation.opacity || 1,
    hitStrokeWidth: 8,
  };
});

const anchor1Config = computed(() => {
  const points = linePoints.value;
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
  const points = linePoints.value;
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
  if (!lineNode) return;

  const points = lineNode.points() as [number, number, number, number];

  emit('update', {
    ...props.annotation,
    points: points,
    x: groupNode?.x() ?? props.annotation.x,
    y: groupNode?.y() ?? props.annotation.y,
    updatedAt: dayjs().toISOString(),
  });
}

// アンカのドラッグハンドラ: index 0 = 先頭、index 1 = 末端
function onAnchorDragStart(e: KonvaEvent) {
  const groupNode = groupRef.value?.getNode();
  if (groupNode) {
    groupNode.draggable(false);
  }
  e.cancelBubble = true;
}

function onAnchorDrag0(e: KonvaEvent) {
  onAnchorDrag(0, e);
}

function onAnchorDrag1(e: KonvaEvent) {
  onAnchorDrag(1, e);
}

function onAnchorDrag(idx: 0 | 1, e: KonvaEvent) {
  // 表示をリアルタイム更新するため、ラインの points をその場で更新します
  const lineNode = lineRef.value?.getNode();
  if (!lineNode) return;
  const anchor = e.target as Konva.Rect;
  const points = lineNode.points().slice() as [number, number, number, number];
  const fixedIndex = idx === 0 ? ([2, 3] as const) : ([0, 1] as const);
  const movingIndex = idx === 0 ? ([0, 1] as const) : ([2, 3] as const);
  const fixedPoint = { x: points[fixedIndex[0]], y: points[fixedIndex[1]] };
  const newPoint = { x: anchor.x(), y: anchor.y() };

  if (e.evt.shiftKey) {
    const snappedPoint = snapLineEndpoint(newPoint, fixedPoint);
    anchor.position(snappedPoint);
    points[movingIndex[0]] = snappedPoint.x;
    points[movingIndex[1]] = snappedPoint.y;
  } else {
    points[movingIndex[0]] = newPoint.x;
    points[movingIndex[1]] = newPoint.y;
  }

  lineNode.points(points);
}

function onAnchorDragEnd() {
  onDragEnd();
}

function snapLineEndpoint(point: { x: number; y: number }, fixed: { x: number; y: number }) {
  const dx = point.x - fixed.x;
  const dy = point.y - fixed.y;
  const angle = Math.atan2(dy, dx);
  const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  const length = Math.hypot(dx, dy);
  return {
    x: fixed.x + Math.cos(snapped) * length,
    y: fixed.y + Math.sin(snapped) * length,
  };
}
</script>

<style scoped lang="scss">
// Konvaコンポーネントはスタイル不要
</style>
