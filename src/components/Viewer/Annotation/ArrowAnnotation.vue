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
      onTransformstart: onTransformStart,
      onTransform: onTransform,
      onTransformend: onTransformEnd,
    }"
  >
    <v-line
      ref="shaftRef"
      :config="shaftConfig"
      @mouseenter="onMouseEnter"
      @mouseleave="onMouseLeave"
    />
    <v-circle v-if="startHead?.type === 'circle'" ref="startHeadRef" :config="startHead.config" />
    <v-line v-else-if="startHead" ref="startHeadRef" :config="startHead.config" />
    <v-circle v-if="endHead?.type === 'circle'" ref="endHeadRef" :config="endHead.config" />
    <v-line v-else-if="endHead" ref="endHeadRef" :config="endHead.config" />

    <!-- 端点アンカー: 選択されて編集中の場合のみ表示
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
import { computed, ref, type ComputedRef } from 'vue';
import type Konva from 'konva';
import type { AnnotationID, ArrowAnnotationStyle, ArrowHeadType } from 'src/models/document/pdf';
import type { AnnotationGroupID } from 'src/models/document/group';
import { useAnnotationShape } from './composables/useAnnotationShape';
import { useTwoPointAnchors } from './composables/useMultiPointAnchors';
import {
  TRANSFORMER_ANCHOR_CORNER_RADIUS,
  TRANSFORMER_ANCHOR_FILL,
  TRANSFORMER_ANCHOR_SIZE,
  TRANSFORMER_ANCHOR_STROKE,
  TRANSFORMER_ANCHOR_STROKE_WIDTH,
} from './composables/anchorStyle';
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
  // Konvaステージの拡大率。頂点アンカーの見た目上のサイズをズームに関わらず一定に保つために使う
  stageScale?: number;
  // 複数選択（グループ含む）の一員として共有Transformerでリサイズ中かどうか。trueの間は
  // 頂点アンカーを隠し、グループ全体のscaleをpointsへ焼き込む（onTransform/onTransformEnd参照）
  isGroupTransform?: boolean;
  // 所属グループのID（未所属ならundefined）。グループを端点とする関係性の検証結果を
  // このシェイプのスタイルへ反映するために使う（useAnnotationShape参照）
  groupId?: AnnotationGroupID;
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
const startHeadRef = ref<{ getNode: () => Konva.Circle | Konva.Line | null } | null>(null);
const endHeadRef = ref<{ getNode: () => Konva.Circle | Konva.Line | null } | null>(null);
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
    annotation.points[0]!,
    annotation.points[1]!,
    annotation.points[2]!,
    annotation.points[3]!,
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
      return {
        type: headType,
        config: { ...base, radius: getHeadRadius(headType, headSize) ?? 0 },
      };
    }
    const points = getHeadLocalPoints(headType, headSize);
    if (!points) return null;
    return { type: headType, config: { ...base, points, closed: isClosedHead(headType) } };
  });
}

const startHead = buildHeadInfo('start');
const endHead = buildHeadInfo('end');

/**
 * 端点アンカーのドラッグ中、矢じりノードの位置・角度を直接書き換えてライブ追従させる
 *
 * シャフト（v-line）はドラッグ中`shapeNode.points(points)`で直接書き換えられ即座に追従するが、
 * 矢じりは別ノード（startHead/endHead）としてVueの再描画（displayAnnotationの更新＝ドラッグ確定後）
 * を待って初めて追従する構造のため、確定前は取り残されて見えてしまう（要修正の対象バグ）。
 * 始点・終点どちらのアンカーを動かしても両矢じりの角度は変わりうるため、常に両方を再計算する
 */
function updateHeadsLive(points: readonly number[]) {
  const annotation = displayAnnotation.value;
  (['start', 'end'] as const).forEach((end) => {
    const headType = end === 'start' ? annotation.startHead : annotation.endHead;
    if (headType === 'none') return;

    const transform = computeHeadTransform(points, end);
    if (!transform) return;

    const node = (end === 'start' ? startHeadRef.value : endHeadRef.value)?.getNode();
    node?.position({ x: transform.tipX, y: transform.tipY });
    node?.rotation(transform.angleDeg);
  });
}

// ステージの拡大率と逆のscaleを乗せることで、頂点アンカーの見た目上のサイズをズームに
// 関わらず一定に保つ（issue #49）。stageScaleが0以下になる異常値では逆数が発散するため1にフォールバックする
const anchorInverseScale = computed(() => {
  const scale = props.stageScale ?? 1;
  return scale > 0 ? 1 / scale : 1;
});

const anchor1Config = computed(() => {
  const annotation = displayAnnotation.value;
  const points = arrowPoints.value;
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
  const points = arrowPoints.value;
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

/**
 * 複数選択の共有Transformerによるグループ変形: グループのscaleX/scaleY/rotationをpoints
 * （グループ原点からの相対座標）へ焼き込み、scale/rotationを既定値（1・1・0）に戻す。
 * 矢じりはシャフトとは別ノードのため、新しいpointsをもとにupdateHeadsLiveで位置・角度を
 * ライブ追従させる（回転を焼き込んだ後も矢じりの向きが古いままにならないよう必須）
 *
 * Konvaのノードは`translate(x,y) -> rotate(rotation) -> scale(scaleX,scaleY)`の順で
 * 子のローカル座標へ変換を適用する（Node.getTransform参照）。そのため焼き込みも同じ順序
 * （まずscaleを掛け、その結果を回転行列で回す）で行わないと、リサイズと回転を同時に行った
 * 場合に見た目がずれる
 *
 * KonvaのTransformerは複数ノード変形時、各tickで「そのノードの現在のライブな状態」を基準に
 * 増分（incremental）scale/rotationを適用する。そのため掛け算の元になる座標は、ジェスチャー
 * 開始前の値に固定されるVue computed（arrowPoints）ではなく、直前のtickで実際に書き込んだ
 * Konvaノード自身のpoints()を使う必要がある（そうしないと開始前の古い座標に増分変形を
 * 掛け続けることになり、tickを重ねるたびに実際の見た目とずれていく）
 */
function syncGroupTransformGeometry(groupNode: Konva.Group): [number, number, number, number] {
  const scaleX = groupNode.scaleX();
  const scaleY = groupNode.scaleY();
  const rotationRad = (groupNode.rotation() * Math.PI) / 180;
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);
  // スケール済みの座標を回転行列で回す（Konvaの変換順序に合わせる）
  const rotateScaled = (x: number, y: number): [number, number] => {
    const scaledX = x * scaleX;
    const scaledY = y * scaleY;
    return [scaledX * cos - scaledY * sin, scaledX * sin + scaledY * cos];
  };

  const shaftNode = shaftRef.value?.getNode();
  const currentPoints = shaftNode?.points() ?? arrowPoints.value;
  const [x1, y1] = rotateScaled(currentPoints[0], currentPoints[1]);
  const [x2, y2] = rotateScaled(currentPoints[2], currentPoints[3]);
  const nextPoints: [number, number, number, number] = [x1, y1, x2, y2];
  shaftNode?.points(nextPoints);
  updateHeadsLive(nextPoints);
  groupNode.setAttrs({ scaleX: 1, scaleY: 1, rotation: 0 });
  return nextPoints;
}

/** 共有Transformerによるグループ変形の開始。他の編集操作と同様にUndo履歴の対象として扱う */
function onTransformStart() {
  beginInteraction();
}

/** 共有Transformerによるグループ変形中、各tickでscale・rotationをpointsへ焼き込む（確定はまだしない） */
function onTransform(e: Konva.KonvaEventObject<Event>) {
  syncGroupTransformGeometry(e.target as Konva.Group);
}

/** 共有Transformerによるグループ変形の確定。焼き込み済みのpoints・位置を親へ通知する */
function onTransformEnd(e: Konva.KonvaEventObject<Event>) {
  const groupNode = e.target as Konva.Group;
  const points = syncGroupTransformGeometry(groupNode);
  const updated = withUpdatedTimestamp({ x: groupNode.x(), y: groupNode.y(), points });
  emit('update', updated);
  endInteraction(updated);
}

const { onAnchorDragStart, onAnchorDrag0, onAnchorDrag1, onAnchorDragEnd } = useTwoPointAnchors({
  getShapeNode: () => shaftRef.value?.getNode() ?? null,
  getGroupNode: () => groupRef.value?.getNode() ?? null,
  getGroupDraggable: () => props.isEditing && props.allowDrag && !ctrlKey.value,
  getAnchorNode: (idx) =>
    (idx === 0 ? anchor1Ref.value?.getNode() : anchor2Ref.value?.getNode()) ?? null,
  onPointsChange: updateHeadsLive,
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
