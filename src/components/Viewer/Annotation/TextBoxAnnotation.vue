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
import { useAnnotationShape } from './composables/useAnnotationShape';

interface Props {
  annotation: TextAnnotationStyle;
  isEditing: boolean;
  isSelected?: boolean;
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
  withUpdatedTimestamp,
  displayAnnotation,
  beginInteraction,
  endInteraction,
} = useAnnotationShape(props);

const groupConfig = computed(() => ({
  x: displayAnnotation.value.x,
  y: displayAnnotation.value.y,
  id: displayAnnotation.value.id,
  draggable: props.isEditing,
  onDragstart: beginInteraction,
  onDragend: onDragEnd,
  onTransformstart: beginInteraction,
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
    fill: relationalOverride.value?.fill ?? annotation.fillColor ?? 'transparent',
    stroke: relationalOverride.value?.stroke ?? annotation.color,
    // strokeWidth未指定/0（デフォルト状態）でも選択・視認しやすいよう、他形状と同様に細い枠線へフォールバックする
    strokeWidth: relationalOverride.value?.strokeWidth ?? (annotation.strokeWidth || 1),
    opacity: annotation.opacity ?? 1,
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
    fill: annotation.textColor,
    align: annotation.textAlign,
    padding: 4,
    wrap: 'word' as const,
    verticalAlign: 'top' as const,
    opacity: annotation.opacity ?? 1,
  };
});

function getNode() {
  return groupRef.value?.getNode() ?? null;
}

defineExpose({ getNode });

function onDragEnd() {
  const groupNode = groupRef.value?.getNode();
  if (!groupNode) {
    endInteraction();
    return;
  }

  const updated = withUpdatedTimestamp({ x: groupNode.x(), y: groupNode.y() });
  emit('update', updated);
  endInteraction(updated);
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

function onTransform(e: Konva.KonvaEventObject<Event>) {
  syncNodeGeometry(e.target as Konva.Group);
}

function onTransformEnd(e: Konva.KonvaEventObject<Event>) {
  const groupNode = e.target as Konva.Group;
  const { width, height } = syncNodeGeometry(groupNode);

  const updated = withUpdatedTimestamp({ x: groupNode.x(), y: groupNode.y(), width, height });
  emit('update', updated);
  endInteraction(updated);
}
</script>

<style scoped lang="scss">
// Konvaコンポーネントはスタイル不要
</style>
