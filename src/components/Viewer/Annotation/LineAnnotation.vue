<template>
  <!-- Group used so line and its endpoint anchors move together when dragged -->
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
      onTransformstart: onTransformStart,
      onTransform: onTransform,
      onTransformend: onTransformEnd,
    }"
  >
    <v-line
      ref="lineRef"
      :config="lineConfig"
      @mouseenter="onMouseEnter"
      @mouseleave="onMouseLeave"
    />

    <!-- Endpoint anchors: shown only when the annotation is selected for editing
         （複数選択の共有Transformerでリサイズ中は、頂点アンカーではなくTransformer側に委ねる） -->
    <template v-if="props.isEditing && props.isSelected && !props.isGroupTransform">
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
import { useTwoPointAnchors } from './composables/useMultiPointAnchors';
import {
  TRANSFORMER_ANCHOR_CORNER_RADIUS,
  TRANSFORMER_ANCHOR_FILL,
  TRANSFORMER_ANCHOR_SIZE,
  TRANSFORMER_ANCHOR_STROKE,
  TRANSFORMER_ANCHOR_STROKE_WIDTH,
} from './composables/anchorStyle';

interface Props {
  annotation: LineAnnotationStyle;
  isEditing: boolean;
  isSelected?: boolean;
  // pointerモード時、未選択でも即ドラッグ移動できるようにするかどうか（描画モード中はfalseにし、
  // 既存アノテーション上での曖昧開始（クリック=選択・ドラッグ=新規描画）と競合しないようにする）
  allowDrag: boolean;
  // Konvaステージの拡大率。頂点アンカーの見た目上のサイズをズームに関わらず一定に保つために使う
  stageScale?: number;
  // 複数選択（グループ含む）の一員として共有Transformerでリサイズ中かどうか。trueの間は
  // 頂点アンカーを隠し、グループ全体のscaleをpointsへ焼き込む（onTransform/onTransformEnd参照）
  isGroupTransform?: boolean;
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

const linePoints = computed(() => {
  const annotation = displayAnnotation.value;
  if (annotation.type !== 'line') return [0, 0, 0, 0] as const;
  if (annotation.points.length !== 4) return [0, 0, 0, 0] as const;
  return [
    annotation.points[0],
    annotation.points[1],
    annotation.points[2],
    annotation.points[3],
  ] as const;
});

const lineConfig = computed(() => {
  const annotation = displayAnnotation.value;
  return {
    id: annotation.id,
    name: 'annotation-shape',
    points: linePoints.value,
    stroke: resolvedStroke.value,
    strokeWidth: relationalOverride.value?.strokeWidth ?? (annotation.strokeWidth || 2),
    dash: strokeDash.value,
    globalCompositeOperation: globalCompositeOperation.value,
    draggable: false,
    hitStrokeWidth: hitStrokeWidth.value,
  };
});

// ステージの拡大率と逆のscaleを乗せることで、頂点アンカーの見た目上のサイズをズームに
// 関わらず一定に保つ（issue #49）。stageScaleが0以下になる異常値では逆数が発散するため1にフォールバックする
const anchorInverseScale = computed(() => {
  const scale = props.stageScale ?? 1;
  return scale > 0 ? 1 / scale : 1;
});

const anchor1Config = computed(() => {
  const annotation = displayAnnotation.value;
  const points = linePoints.value;
  return {
    id: `${annotation.id}-anchor-0`,
    annotationId: annotation.id,
    x: points[0],
    y: points[1],
    width: TRANSFORMER_ANCHOR_SIZE,
    height: TRANSFORMER_ANCHOR_SIZE,
    offset: { x: TRANSFORMER_ANCHOR_SIZE / 2, y: TRANSFORMER_ANCHOR_SIZE / 2 },
    scaleX: anchorInverseScale.value,
    scaleY: anchorInverseScale.value,
    name: 'annotation-anchor',
    // box/circle/textが使うKonva Transformerの頂点と見た目を揃える
    fill: TRANSFORMER_ANCHOR_FILL,
    stroke: TRANSFORMER_ANCHOR_STROKE,
    strokeWidth: TRANSFORMER_ANCHOR_STROKE_WIDTH,
    cornerRadius: TRANSFORMER_ANCHOR_CORNER_RADIUS,
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
    width: TRANSFORMER_ANCHOR_SIZE,
    height: TRANSFORMER_ANCHOR_SIZE,
    offset: { x: TRANSFORMER_ANCHOR_SIZE / 2, y: TRANSFORMER_ANCHOR_SIZE / 2 },
    scaleX: anchorInverseScale.value,
    scaleY: anchorInverseScale.value,
    name: 'annotation-anchor',
    // box/circle/textが使うKonva Transformerの頂点と見た目を揃える
    fill: TRANSFORMER_ANCHOR_FILL,
    stroke: TRANSFORMER_ANCHOR_STROKE,
    strokeWidth: TRANSFORMER_ANCHOR_STROKE_WIDTH,
    cornerRadius: TRANSFORMER_ANCHOR_CORNER_RADIUS,
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

/**
 * 複数選択の共有Transformerによるグループ変形: グループのscaleX/scaleYをpoints（グループ原点
 * からの相対座標）へ焼き込み、scaleを1に戻す。頂点0だけをドラッグして原点がずれている場合でも、
 * 各座標成分に同じscaleを掛けるだけでKonvaのローカル座標系での拡縮と一致する
 *
 * KonvaのTransformerは複数ノード変形時、各tickで「そのノードの現在のライブな状態」を基準に
 * 増分（incremental）scaleを適用する。そのため掛け算の元になる座標は、ジェスチャー開始前の
 * 値に固定されるVue computed（linePoints）ではなく、直前のtickで実際に書き込んだ
 * Konvaノード自身のpoints()を使う必要がある（そうしないと開始前の古い座標に増分scaleを
 * 掛け続けることになり、tickを重ねるたびに実際の見た目とずれていく）
 */
function syncGroupTransformGeometry(groupNode: Konva.Group): [number, number, number, number] {
  const scaleX = groupNode.scaleX();
  const scaleY = groupNode.scaleY();
  const lineNode = lineRef.value?.getNode();
  const currentPoints = lineNode?.points() ?? linePoints.value;
  const nextPoints: [number, number, number, number] = [
    currentPoints[0]! * scaleX,
    currentPoints[1]! * scaleY,
    currentPoints[2]! * scaleX,
    currentPoints[3]! * scaleY,
  ];
  lineNode?.points(nextPoints);
  groupNode.setAttrs({ scaleX: 1, scaleY: 1 });
  return nextPoints;
}

function onTransformStart() {
  beginInteraction();
}

function onTransform(e: Konva.KonvaEventObject<Event>) {
  syncGroupTransformGeometry(e.target as Konva.Group);
}

function onTransformEnd(e: Konva.KonvaEventObject<Event>) {
  const groupNode = e.target as Konva.Group;
  const points = syncGroupTransformGeometry(groupNode);
  const updated = withUpdatedTimestamp({ x: groupNode.x(), y: groupNode.y(), points });
  emit('update', updated);
  endInteraction(updated);
}

const { onAnchorDragStart, onAnchorDrag0, onAnchorDrag1, onAnchorDragEnd } = useTwoPointAnchors({
  getShapeNode: () => lineRef.value?.getNode() ?? null,
  getGroupNode: () => groupRef.value?.getNode() ?? null,
  getGroupDraggable: () => props.isEditing && props.allowDrag && !ctrlKey.value,
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
