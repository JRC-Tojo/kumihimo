<template>
  <!-- lineと同様、グループにまとめることで矢印本体とアンカーが一緒にドラッグされるようにする -->
  <v-group
    ref="groupRef"
    :config="{
      x: displayAnnotation.x,
      y: displayAnnotation.y,
      id: displayAnnotation.id,
      draggable: props.isEditing && props.allowDrag && !ctrlKey,
      dragBoundFunc,
      onDragstart: onGroupDragStart,
      onDragend: onDragEnd,
    }"
  >
    <v-line
      ref="shaftRef"
      :config="shaftConfig"
      @mouseenter="onMouseEnter"
      @mouseleave="onMouseLeave"
    />
    <v-circle v-if="startHead?.type === 'circle'" :config="startHead.config" />
    <v-line v-else-if="startHead" :config="startHead.config" />
    <v-circle v-if="endHead?.type === 'circle'" :config="endHead.config" />
    <v-line v-else-if="endHead" :config="endHead.config" />

    <!-- 端点アンカー: 選択されて編集中の場合のみ表示 -->
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
import { computed, ref, type ComputedRef } from 'vue';
import type Konva from 'konva';
import type { AnnotationID, ArrowAnnotationStyle, ArrowHeadType } from 'src/models/document/pdf';
import { useAnnotationShape } from './composables/useAnnotationShape';
import { useTwoPointAnchors } from './composables/useTwoPointAnchors';
import {
  computeHeadTransform,
  getHeadLocalPoints,
  getHeadRadius,
  isClosedHead,
  isFilledHead,
} from './arrowHeadGeometry';

interface Props {
  annotation: ArrowAnnotationStyle;
  isEditing: boolean;
  isSelected?: boolean;
  // pointerモード時、未選択でも即ドラッグ移動できるようにするかどうか（描画モード中はfalseにし、
  // 既存アノテーション上での曖昧開始（クリック=選択・ドラッグ=新規描画）と競合しないようにする）
  allowDrag: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  update: [annotation: ArrowAnnotationStyle];
  delete: [id: AnnotationID];
}>();

const groupRef = ref<{ getNode: () => Konva.Group | null } | null>(null);
const shaftRef = ref<{ getNode: () => Konva.Line | null } | null>(null);
const anchor1Ref = ref<{ getNode: () => Konva.Rect | null } | null>(null);
const anchor2Ref = ref<{ getNode: () => Konva.Rect | null } | null>(null);
const isHovered = ref(false);

const {
  relationalOverride,
  strokeDash,
  globalCompositeOperation,
  hitStrokeWidth,
  resolvedStroke,
  withUpdatedTimestamp,
  displayAnnotation,
  beginInteraction,
  endInteraction,
  ctrlKey,
  dragBoundFunc,
  beginBodyDrag,
  commitBodyDrag,
} = useAnnotationShape(props);

const arrowPoints = computed(() => {
  const annotation = displayAnnotation.value;
  if (annotation.points.length !== 4) return [0, 0, 0, 0] as const;
  return [
    annotation.points[0],
    annotation.points[1],
    annotation.points[2],
    annotation.points[3],
  ] as const;
});

const resolvedStrokeWidth = computed(
  () => relationalOverride.value?.strokeWidth ?? (displayAnnotation.value.strokeWidth || 2),
);

const shaftConfig = computed(() => {
  const annotation = displayAnnotation.value;
  return {
    id: annotation.id,
    name: 'annotation-shape',
    points: arrowPoints.value,
    stroke: resolvedStroke.value,
    strokeWidth: resolvedStrokeWidth.value,
    dash: strokeDash.value,
    globalCompositeOperation: globalCompositeOperation.value,
    draggable: false,
    hitStrokeWidth: hitStrokeWidth.value,
  };
});

interface ArrowHeadRenderInfo {
  type: ArrowHeadType;
  config: Record<string, unknown>;
}

/**
 * 矢じり（始点/終点）の実際のKonva描画設定を組み立てる。KonvaネイティブのArrowは
 * 塗りつぶし可否が始点・終点で共通のフラグしか持たないため使えず（両端で独立した見た目に
 * できない）、arrowHeadGeometry.tsのローカル座標を実際の端点座標・角度へ変換して
 * v-line（多くの矢じり形状）またはv-circle（'circle'のみ）として描画する
 */
function buildHeadInfo(end: 'start' | 'end'): ComputedRef<ArrowHeadRenderInfo | null> {
  return computed(() => {
    const annotation = displayAnnotation.value;
    const headType = end === 'start' ? annotation.startHead : annotation.endHead;
    if (headType === 'none') return null;

    const transform = computeHeadTransform(arrowPoints.value, end);
    if (!transform) return null;

    const headSize = annotation.headSize ?? 10;
    const base = {
      id: annotation.id,
      name: 'annotation-shape',
      x: transform.tipX,
      y: transform.tipY,
      rotation: transform.angleDeg,
      stroke: resolvedStroke.value,
      strokeWidth: resolvedStrokeWidth.value,
      fill: resolvedStroke.value,
      fillEnabled: isFilledHead(headType),
      globalCompositeOperation: globalCompositeOperation.value,
      draggable: false,
      listening: props.isEditing,
      hitStrokeWidth: hitStrokeWidth.value,
    };

    if (headType === 'circle') {
      return { type: headType, config: { ...base, radius: getHeadRadius(headType, headSize) ?? 0 } };
    }
    const points = getHeadLocalPoints(headType, headSize);
    if (!points) return null;
    return { type: headType, config: { ...base, points, closed: isClosedHead(headType) } };
  });
}

const startHead = buildHeadInfo('start');
const endHead = buildHeadInfo('end');

const anchor1Config = computed(() => {
  const annotation = displayAnnotation.value;
  const points = arrowPoints.value;
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
    // アンカーは注釈本体の色とは別の編集UIのため、線色が未設定（「色なし」）でも常に見えるようにする
    stroke: annotation.color ?? '#000000',
    strokeWidth: 2,
    cornerRadius: 0,
    draggable: props.isEditing && !!props.isSelected,
    listening: props.isEditing && !!props.isSelected,
    cursor: props.isEditing && !!props.isSelected ? 'grab' : 'default',
  };
});

const anchor2Config = computed(() => {
  const annotation = displayAnnotation.value;
  const points = arrowPoints.value;
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
    // アンカーは注釈本体の色とは別の編集UIのため、線色が未設定（「色なし」）でも常に見えるようにする
    stroke: annotation.color ?? '#000000',
    strokeWidth: 2,
    cornerRadius: 0,
    draggable: props.isEditing && !!props.isSelected,
    listening: props.isEditing && !!props.isSelected,
    cursor: props.isEditing && !!props.isSelected ? 'grab' : 'default',
  };
});

function getNode() {
  // 親がTransformerを割り当てられるようにグループノードを公開する（矢印は個別アンカー編集のため実際には未使用）
  return groupRef.value?.getNode() ?? shaftRef.value?.getNode() ?? null;
}

defineExpose({ getNode });

function onMouseEnter() {
  isHovered.value = true;
}

function onMouseLeave() {
  isHovered.value = false;
}

function onGroupDragStart() {
  const groupNode = groupRef.value?.getNode();
  if (groupNode) beginBodyDrag(groupNode);
  else beginInteraction();
}

function onDragEnd(e: Konva.KonvaEventObject<Event>) {
  const groupNode = groupRef.value?.getNode();
  if (!groupNode) {
    endInteraction();
    return;
  }

  emit('update', commitBodyDrag(e, { x: groupNode.x(), y: groupNode.y() }));
}

const { onAnchorDragStart, onAnchorDrag0, onAnchorDrag1, onAnchorDragEnd } = useTwoPointAnchors({
  getShapeNode: () => shaftRef.value?.getNode() ?? null,
  getGroupNode: () => groupRef.value?.getNode() ?? null,
  getAnchorNode: (idx) =>
    (idx === 0 ? anchor1Ref.value?.getNode() : anchor2Ref.value?.getNode()) ?? null,
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
