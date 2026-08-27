<template>
  <!-- ポリゴン本体と頂点アンカーが一緒にドラッグされるようグループにまとめる -->
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
      ref="shapeRef"
      :config="shapeConfig"
      @mouseenter="onMouseEnter"
      @mouseleave="onMouseLeave"
    />

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
import { computed, ref } from 'vue';
import type Konva from 'konva';
import type { AnnotationID, PolygonAnnotationStyle } from 'src/models/document/pdf';
import type { AnnotationGroupID } from 'src/models/document/group';
import { useAnnotationShape } from './composables/useAnnotationShape';
import { useMultiPointAnchors } from './composables/useMultiPointAnchors';
import { buildPointAnchorConfigs } from './composables/multiPointAnchorConfig';

interface Props {
  annotation: PolygonAnnotationStyle;
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
  update: [annotation: PolygonAnnotationStyle];
  delete: [id: AnnotationID];
}>();

const groupRef = ref<{ getNode: () => Konva.Group | null } | null>(null);
const shapeRef = ref<{ getNode: () => Konva.Line | null } | null>(null);
const isHovered = ref(false);

const {
  relationalOverride,
  strokeDash,
  globalCompositeOperation,
  hitStrokeWidth,
  resolvedStroke,
  resolveFill,
  withUpdatedTimestamp,
  displayAnnotation,
  beginInteraction,
  endInteraction,
  ctrlKey,
  dragBoundFunc,
  beginBodyDrag,
  commitBodyDrag,
} = useAnnotationShape(props);

const shapeConfig = computed(() => {
  const annotation = displayAnnotation.value;
  return {
    id: annotation.id,
    name: 'annotation-shape',
    points: annotation.points,
    closed: true,
    fill: resolveFill(annotation.fillColor, annotation.fillOpacity),
    stroke: resolvedStroke.value,
    strokeWidth: relationalOverride.value?.strokeWidth ?? (annotation.strokeWidth || 2),
    dash: strokeDash.value,
    globalCompositeOperation: globalCompositeOperation.value,
    draggable: false,
    hitStrokeWidth: hitStrokeWidth.value,
  };
});

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
 * からの相対座標、任意個数）へ焼き込み、scaleを1に戻す
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
  const shapeNode = shapeRef.value?.getNode();
  const points = shapeNode?.points() ?? displayAnnotation.value.points;
  const nextPoints = points.map((v, i) => (i % 2 === 0 ? v * scaleX : v * scaleY));
  shapeNode?.points(nextPoints);
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
  getShapeNode: () => shapeRef.value?.getNode() ?? null,
  getGroupNode: () => groupRef.value?.getNode() ?? null,
  getGroupDraggable: () => props.isEditing && props.allowDrag && !ctrlKey.value,
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
