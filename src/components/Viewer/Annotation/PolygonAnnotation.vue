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
  // pointerモード時、未選択でも即ドラッグ移動できるようにするかどうか（描画モード中はfalseにし、
  // 既存アノテーション上での曖昧開始（クリック=選択・ドラッグ=新規描画）と競合しないようにする）
  allowDrag: boolean;
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
    // 塗りがtransparent/薄い場合でも辺をクリックで選択できるよう、当たり判定の太さを広げる（Polylineと同様）
    hitStrokeWidth: Math.max(12, (annotation.strokeWidth || 2) * 4),
  };
});

const anchorConfigs = computed(() => {
  const annotation = displayAnnotation.value;
  return buildPointAnchorConfigs(
    annotation.points,
    annotation.color,
    annotation.id,
    props.isEditing,
    !!props.isSelected,
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

const { onAnchorDragStart, onAnchorDrag, onAnchorDragEnd } = useMultiPointAnchors({
  getShapeNode: () => shapeRef.value?.getNode() ?? null,
  getGroupNode: () => groupRef.value?.getNode() ?? null,
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
