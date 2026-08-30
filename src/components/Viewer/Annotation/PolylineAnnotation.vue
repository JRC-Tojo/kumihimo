<template>
  <!-- 折れ線本体と頂点アンカーが一緒にドラッグされるようグループにまとめる -->
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

    <!-- 頂点アンカー: 選択されて編集中の場合のみ表示
         （複数選択の共有Transformerでリサイズ中は、頂点アンカーではなくTransformer側に委ねる） -->
    <template v-if="props.isEditing && props.isSelected && !props.isGroupTransform">
      <v-rect
        v-for="(anchor, i) in anchorConfigs"
        :key="anchor.id"
        :config="anchor"
        @dragstart="wrappedAnchorDragStart"
        @dragmove="(e: Konva.KonvaEventObject<MouseEvent>) => onAnchorDrag(i, e)"
        @dragend="onAnchorDragEnd"
      />
    </template>
  </v-group>
</template>

<script setup lang="ts">
import { computed, ref, type ComputedRef } from 'vue';
import type Konva from 'konva';
import type { AnnotationID, ArrowHeadType, PolylineAnnotationStyle } from 'src/models/document/pdf';
import type { AnnotationGroupID } from 'src/models/document/group';
import { useAnnotationShape } from './composables/useAnnotationShape';
import { useMultiPointAnchors } from './composables/useMultiPointAnchors';
import { buildPointAnchorConfigs } from './composables/multiPointAnchorConfig';
import {
  computeHeadTransform,
  getHeadLocalPoints,
  getHeadRadius,
  isClosedHead,
  isFilledHead,
} from './arrowHeadGeometry';

interface Props {
  annotation: PolylineAnnotationStyle;
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
  // このアノテーションが属するファイルの関係性一覧読み込みが失敗しているか（trueの間はNGと
  // 同じスタイルで警告表示する。useAnnotationShape参照）
  relationalLoadError?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  update: [annotation: PolylineAnnotationStyle];
  delete: [id: AnnotationID];
}>();

const groupRef = ref<{ getNode: () => Konva.Group | null } | null>(null);
const shaftRef = ref<{ getNode: () => Konva.Line | null } | null>(null);
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

const resolvedStrokeWidth = computed(
  () => relationalOverride.value?.strokeWidth ?? (displayAnnotation.value.strokeWidth || 2),
);

const shaftConfig = computed(() => {
  const annotation = displayAnnotation.value;
  return {
    id: annotation.id,
    name: 'annotation-shape',
    points: annotation.points,
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
 * 矢じり（始点/終点）の実際のKonva描画設定を組み立てる（ArrowAnnotation.vueと同じロジック）。
 * 複数頂点で構成される折れ線でも、始点は先頭2点、終点は末尾2点の線分だけを見て向きを決める
 * （computeHeadTransformの規約）
 */
function buildHeadInfo(end: 'start' | 'end'): ComputedRef<ArrowHeadRenderInfo | null> {
  return computed(() => {
    const annotation = displayAnnotation.value;
    const headType = end === 'start' ? annotation.startHead : annotation.endHead;
    if (headType === 'none') return null;

    const transform = computeHeadTransform(annotation.points, end);
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
 * 頂点アンカーのドラッグ中、矢じりノードの位置・角度を直接書き換えてライブ追従させる
 *
 * シャフト（v-line）はドラッグ中`shapeNode.points(points)`で直接書き換えられ即座に追従するが、
 * 矢じりは別ノード（startHead/endHead）としてVueの再描画（displayAnnotationの更新＝ドラッグ確定後）
 * を待って初めて追従する構造のため、確定前は取り残されて見えてしまう（要修正の対象バグ）。
 * どの頂点を動かしても両矢じりの角度は変わりうるため、常に両方を再計算する
 * （computeHeadTransformの規約通り、始点は先頭2点・終点は末尾2点の線分のみを見る）
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

const anchorConfigs = computed(() => {
  const annotation = displayAnnotation.value;
  return buildPointAnchorConfigs(
    annotation.points,
    annotation.id,
    props.isEditing,
    !!props.isSelected,
    props.stageScale ?? 1,
  );
});

function getNode() {
  // 親がTransformerを割り当てられるようにグループノードを公開する（折れ線は個別アンカー編集のため実際には未使用）
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

  // commitBodyDragが内部でendInteractionを呼び済みのため、ここでは呼ばない
  emit('update', commitBodyDrag(e, { x: groupNode.x(), y: groupNode.y() }));
}

/**
 * 複数選択の共有Transformerによるグループ変形: グループのscaleX/scaleYをpoints（グループ原点
 * からの相対座標、任意個数）へ焼き込み、scaleを1に戻す。矢じりはシャフトとは別ノードのため、
 * 新しいpointsをもとにupdateHeadsLiveで位置・角度をライブ追従させる
 *
 * KonvaのTransformerは複数ノード変形時、各tickで「そのノードの現在のライブな状態」を基準に
 * 増分（incremental）scaleを適用する。そのため掛け算の元になる座標は、ジェスチャー開始前の
 * 値に固定されるVue computed（displayAnnotation.value.points）ではなく、直前のtickで実際に
 * 書き込んだKonvaノード自身のpoints()を使う必要がある（そうしないと開始前の古い座標に
 * 増分scaleを掛け続けることになり、tickを重ねるたびに実際の見た目とずれていく）
 */
function syncGroupTransformGeometry(groupNode: Konva.Group): number[] {
  const scaleX = groupNode.scaleX();
  const scaleY = groupNode.scaleY();
  const shaftNode = shaftRef.value?.getNode();
  const points = shaftNode?.points() ?? displayAnnotation.value.points;
  const nextPoints = points.map((v, i) => (i % 2 === 0 ? v * scaleX : v * scaleY));
  shaftNode?.points(nextPoints);
  updateHeadsLive(nextPoints);
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

const { onAnchorDragStart, onAnchorDrag, onAnchorDragEnd } = useMultiPointAnchors({
  getShapeNode: () => shaftRef.value?.getNode() ?? null,
  getGroupNode: () => groupRef.value?.getNode() ?? null,
  getGroupDraggable: () => props.isEditing && props.allowDrag && !ctrlKey.value,
  onPointsChange: updateHeadsLive,
  // 頂点ドラッグ確定時: emitした内容をそのままdisplayAnnotationへ反映する。
  // props.annotation（DB反映待ちでまだ古い）へ再同期すると、確定直後に一瞬古い座標へ巻き戻って見えるため
  onCommit: (points) => {
    const updated = withUpdatedTimestamp({ points });
    emit('update', updated);
    endInteraction(updated);
  },
});

// 頂点ドラッグ開始時もliveQueryの再emitでpropsが巻き戻らないよう、開始をuseAnnotationShapeの状態と連動させる
function wrappedAnchorDragStart(e: Konva.KonvaEventObject<MouseEvent>) {
  beginInteraction();
  onAnchorDragStart(e);
}
</script>

<style scoped lang="scss">
// Konvaコンポーネントはスタイル不要
</style>
