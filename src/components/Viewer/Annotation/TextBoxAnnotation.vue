<template>
  <!-- 背景矩形と本文が一緒にドラッグ・リサイズされるようグループにまとめる -->
  <v-group ref="groupRef" :config="groupConfig">
    <v-rect ref="rectRef" :config="rectConfig" />
    <v-text ref="textRef" :config="textConfig" />
  </v-group>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type Konva from 'konva';
import type { AnnotationID, TextAnnotationStyle } from 'src/models/document/pdf';
import type { AnnotationGroupID } from 'src/models/document/group';
import { useAnnotationShape } from './composables/useAnnotationShape';
import { hexToRgba } from 'src/utils/color/hexToRgba';

interface Props {
  annotation: TextAnnotationStyle;
  isEditing: boolean;
  isSelected?: boolean;
  // pointerモード時、未選択でも即ドラッグ移動できるようにするかどうか（描画モード中はfalseにし、
  // 既存アノテーション上での曖昧開始（クリック=選択・ドラッグ=新規描画）と競合しないようにする）
  allowDrag: boolean;
  // text自体では未使用（頂点アンカーを持つline/arrow/polyline/polygon向けのprop）。
  // AnnotationLayer.vueが全種別共通で渡すため、KonvaのscaleとFallthroughで衝突しないよう宣言だけしておく
  stageScale?: number;
  // 複数選択（グループ含む）の一員として共有Transformerでリサイズ中かどうか。trueの間は
  // Transformer側のcenteredScalingに任せ、シェイプ自身のCtrl中心固定補正を二重適用しない
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
  update: [annotation: TextAnnotationStyle];
  delete: [id: AnnotationID];
}>();

const groupRef = ref<{ getNode: () => Konva.Group | null } | null>(null);
const rectRef = ref<{ getNode: () => Konva.Rect | null } | null>(null);
const textRef = ref<{ getNode: () => Konva.Text | null } | null>(null);

const {
  relationalOverride,
  strokeDash,
  globalCompositeOperation,
  resolvedStroke,
  resolveFill,
  resolveOpacity,
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

const groupConfig = computed(() => ({
  x: displayAnnotation.value.x,
  y: displayAnnotation.value.y,
  id: displayAnnotation.value.id,
  draggable: props.isEditing && props.allowDrag && !ctrlKey.value,
  dragBoundFunc,
  onDragstart: onDragStart,
  onDragend: onDragEnd,
  onTransformstart: onTransformStart,
  onTransform: onTransform,
  onTransformend: onTransformEnd,
}));

const rectConfig = computed(() => {
  const annotation = displayAnnotation.value;
  return {
    id: annotation.id,
    name: 'annotation-shape',
    x: 0,
    y: 0,
    width: annotation.width ?? 0,
    height: annotation.height ?? 0,
    fill: resolveFill(annotation.fillColor, annotation.fillOpacity),
    stroke: resolvedStroke.value,
    // strokeWidth未指定/0（デフォルト状態）でも選択・視認しやすいよう、他形状と同様に細い枠線へフォールバックする
    strokeWidth: relationalOverride.value?.strokeWidth ?? (annotation.strokeWidth || 1),
    dash: strokeDash.value,
    globalCompositeOperation: globalCompositeOperation.value,
  };
});

const textConfig = computed(() => {
  const annotation = displayAnnotation.value;
  return {
    id: annotation.id,
    x: 0,
    y: 0,
    width: annotation.width ?? 0,
    height: annotation.height ?? 0,
    text: annotation.text,
    fontFamily: annotation.fontFamily,
    fontSize: annotation.fontSize,
    fontStyle: annotation.fontWeight >= 700 ? 'bold' : 'normal',
    fill: hexToRgba(annotation.textColor, resolveOpacity(annotation.fillOpacity)),
    align: annotation.textAlign,
    padding: 4,
    wrap: 'word' as const,
    verticalAlign: 'top' as const,
    globalCompositeOperation: globalCompositeOperation.value,
  };
});

function getNode() {
  return groupRef.value?.getNode() ?? null;
}

defineExpose({ getNode });

function onDragStart(e: Konva.KonvaEventObject<Event>) {
  beginBodyDrag(e.target);
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
 * 変形中、グループ全体のscaleを背景矩形・本文それぞれのwidth/heightへ焼き込み、scaleを1に戻す
 * （フォントサイズ自体は変えない＝一般的なテキストボックスの折り返し幅リサイズと同じ挙動）
 */
function syncNodeGeometry(groupNode: Konva.Group) {
  const scaleX = groupNode.scaleX();
  const scaleY = groupNode.scaleY();
  const rectNode = rectRef.value?.getNode();
  const currentWidth = rectNode?.width() ?? props.annotation.width;
  const currentHeight = rectNode?.height() ?? props.annotation.height;
  const nextWidth = Math.max(20, currentWidth * scaleX);
  const nextHeight = Math.max(20, currentHeight * scaleY);

  rectRef.value?.getNode()?.setAttrs({ width: nextWidth, height: nextHeight });
  textRef.value?.getNode()?.setAttrs({ width: nextWidth, height: nextHeight });
  groupNode.setAttrs({ scaleX: 1, scaleY: 1 });

  return { width: nextWidth, height: nextHeight };
}

function onTransformStart(e: Konva.KonvaEventObject<Event>) {
  const groupNode = e.target as Konva.Group;
  const rectNode = rectRef.value?.getNode();
  beginTransform({
    x: groupNode.x(),
    y: groupNode.y(),
    width: rectNode?.width() ?? props.annotation.width,
    height: rectNode?.height() ?? props.annotation.height,
  });
}

function onTransform(e: Konva.KonvaEventObject<Event>) {
  const groupNode = e.target as Konva.Group;
  const { width, height } = syncNodeGeometry(groupNode);
  if (!props.isGroupTransform) applyCenteredCorrection(groupNode, { width, height });
}

function onTransformEnd(e: Konva.KonvaEventObject<Event>) {
  const groupNode = e.target as Konva.Group;
  const { width, height } = syncNodeGeometry(groupNode);
  if (!props.isGroupTransform) applyCenteredCorrection(groupNode, { width, height });

  const updated = withUpdatedTimestamp({ x: groupNode.x(), y: groupNode.y(), width, height });
  emit('update', updated);
  endInteraction(updated);
}
</script>

<style scoped lang="scss">
// Konvaコンポーネントはスタイル不要
</style>
