<template>
  <v-rect
    ref="rectRef"
    :config="rectConfig"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @transformstart="onTransformStart"
    @transform="onTransform"
    @transformend="onTransformEnd"
  />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type Konva from 'konva';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import type { AnnotationGroupID } from 'src/models/document/group';
import { useAnnotationShape } from './composables/useAnnotationShape';

type KonvaEvent = Konva.KonvaEventObject<Event>;

interface Props {
  annotation: AnnotationStyle;
  isEditing: boolean;
  isSelected?: boolean;
  // pointerモード時、未選択でも即ドラッグ移動できるようにするかどうか（描画モード中はfalseにし、
  // 既存アノテーション上での曖昧開始（クリック=選択・ドラッグ=新規描画）と競合しないようにする）
  allowDrag: boolean;
  // box自体では未使用（頂点アンカーを持つline/arrow/polyline/polygon向けのprop）。
  // AnnotationLayer.vueが全種別共通で渡すため、KonvaのscaleとFallthroughで衝突しないよう宣言だけしておく
  stageScale?: number;
  // 複数選択（グループ含む）の一員として共有Transformerでリサイズ中かどうか。trueの間は
  // Transformer側のcenteredScalingに任せ、シェイプ自身のCtrl中心固定補正を二重適用しない
  isGroupTransform?: boolean;
  // 所属グループのID（未所属ならundefined）。グループを端点とする関係性の検証結果を
  // このシェイプのスタイルへ反映するために使う（useAnnotationShape参照）
  groupId?: AnnotationGroupID;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  update: [annotation: AnnotationStyle];
  delete: [id: AnnotationID];
}>();

const rectRef = ref<{ getNode: () => Konva.Rect | null } | null>(null);

const {
  relationalOverride,
  strokeDash,
  globalCompositeOperation,
  resolvedStroke,
  resolveFill,
  withUpdatedTimestamp,
  displayAnnotation,
  endInteraction,
  ctrlKey,
  dragBoundFunc,
  beginBodyDrag,
  commitBodyDrag,
  beginTransform,
  applyCenteredCorrection,
} = useAnnotationShape(props);

const rectConfig = computed(() => {
  const annotation = displayAnnotation.value;
  if (annotation.type !== 'box') return;
  return {
    id: annotation.id,
    name: 'annotation-shape',
    x: annotation.x,
    y: annotation.y,
    width: annotation.width ?? 0,
    height: annotation.height ?? 0,
    fill: resolveFill(annotation.fillColor, annotation.fillOpacity),
    stroke: resolvedStroke.value,
    strokeWidth: relationalOverride.value?.strokeWidth ?? (annotation.strokeWidth || 2),
    dash: strokeDash.value,
    globalCompositeOperation: globalCompositeOperation.value,
    draggable: props.isEditing && props.allowDrag && !ctrlKey.value,
    dragBoundFunc,
  };
});

function getNode() {
  return rectRef.value?.getNode() ?? null;
}

defineExpose({ getNode });

function onDragStart(e: KonvaEvent) {
  beginBodyDrag(e.target);
}

function onDragEnd(e: KonvaEvent) {
  const target = e.target;
  emit('update', commitBodyDrag(e, { x: target.x(), y: target.y() }));
}

/**
 * 変形中の形状を制御する
 */
function syncNodeGeometry(node: Konva.Rect) {
  const nextWidth = Math.max(5, node.width() * node.scaleX());
  const nextHeight = Math.max(5, node.height() * node.scaleY());

  node.setAttrs({
    x: node.x(),
    y: node.y(),
    width: nextWidth,
    height: nextHeight,
    scaleX: 1,
    scaleY: 1,
  });

  return { width: nextWidth, height: nextHeight };
}

function onTransformStart(e: KonvaEvent) {
  const node = e.target as Konva.Rect;
  beginTransform({ x: node.x(), y: node.y(), width: node.width(), height: node.height() });
}

function onTransform(e: KonvaEvent) {
  const node = e.target as Konva.Rect;
  const { width, height } = syncNodeGeometry(node);
  if (!props.isGroupTransform) applyCenteredCorrection(node, { width, height });
}

function onTransformEnd(e: KonvaEvent) {
  const node = e.target as Konva.Rect;
  const { width, height } = syncNodeGeometry(node);
  if (!props.isGroupTransform) applyCenteredCorrection(node, { width, height });

  const updated = withUpdatedTimestamp({ x: node.x(), y: node.y(), width, height });
  emit('update', updated);
  endInteraction(updated);
}
</script>

<style scoped lang="scss">
// Konvaコンポーネントはスタイル不要
</style>
