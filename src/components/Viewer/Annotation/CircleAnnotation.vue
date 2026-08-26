<template>
  <v-ellipse
    ref="ellipseRef"
    :config="ellipseConfig"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
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
import { useAnnotationShape } from './composables/useAnnotationShape';

type KonvaEvent = Konva.KonvaEventObject<Event>;

interface Props {
  annotation: AnnotationStyle;
  isEditing: boolean;
  isSelected?: boolean;
  // pointerモード時、未選択でも即ドラッグ移動できるようにするかどうか（描画モード中はfalseにし、
  // 既存アノテーション上での曖昧開始（クリック=選択・ドラッグ=新規描画）と競合しないようにする）
  allowDrag: boolean;
  // circle自体では未使用（頂点アンカーを持つline/arrow/polyline/polygon向けのprop）。
  // AnnotationLayer.vueが全種別共通で渡すため、KonvaのscaleとFallthroughで衝突しないよう宣言だけしておく
  stageScale?: number;
  // 複数選択（グループ含む）の一員として共有Transformerでリサイズ中かどうか。trueの間は
  // Transformer側のcenteredScalingに任せ、シェイプ自身のCtrl中心固定・正円維持補正を適用しない
  // （scaleX!=scaleYのグループ変形では「常に正円を維持する」ことと両立しないため）
  isGroupTransform?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  update: [annotation: AnnotationStyle];
  delete: [id: AnnotationID];
}>();

const ellipseRef = ref<{ getNode: () => Konva.Ellipse | null } | null>(null);
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

// 変形開始時の中心座標。Ellipseはx/yが常に中心を表すため、Box/Textとは別に中心固定補正を扱う
const transformStartCenter = ref<{ x: number; y: number } | null>(null);

const ellipseConfig = computed(() => {
  const annotation = displayAnnotation.value;
  if (annotation.type !== 'circle') return;
  return {
    id: annotation.id,
    name: 'annotation-shape',
    x: annotation.x,
    y: annotation.y,
    radiusX: annotation.radiusX ?? annotation.radius ?? 20,
    radiusY: annotation.radiusY ?? annotation.radius ?? 20,
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
  return ellipseRef.value?.getNode() ?? null;
}

defineExpose({ getNode });

function onMouseEnter() {
  isHovered.value = true;
}

function onMouseLeave() {
  isHovered.value = false;
}

function onDragStart(e: KonvaEvent) {
  beginBodyDrag(e.target);
}

function onDragEnd(e: KonvaEvent) {
  const target = e.target;
  emit('update', commitBodyDrag(e, { x: target.x(), y: target.y() }));
}

function onTransformStart(e: KonvaEvent) {
  const node = e.target;
  beginInteraction();
  transformStartCenter.value = { x: node.x(), y: node.y() };
}

/**
 * 変形中の形状を制御する
 *
 * Ctrlなし（既定・形状修正）: radiusX/radiusYを独立にscaleX/scaleYから算出し、楕円化を許容する。
 * 中心位置はKonvaの通常のTransformer挙動（反対側コーナー基準）に従う。
 * Ctrlあり（スケール調整）: 中心を固定したまま、両軸を同一のスケール係数で拡大縮小し、常に正円を維持する
 * （「真の拡大縮小」として一貫した挙動になる。図形の角をつかんでのdragにCtrlの有無で区別）
 */
function syncNodeGeometry(node: Konva.Ellipse) {
  const scaleX = node.scaleX();
  const scaleY = node.scaleY();

  if (ctrlKey.value && transformStartCenter.value && !props.isGroupTransform) {
    const uniformScale = Math.max(scaleX, scaleY);
    const nextRadius = Math.max(5, Math.max(node.radiusX(), node.radiusY()) * uniformScale);
    node.setAttrs({
      x: transformStartCenter.value.x,
      y: transformStartCenter.value.y,
      radiusX: nextRadius,
      radiusY: nextRadius,
      scaleX: 1,
      scaleY: 1,
    });
    return { radiusX: nextRadius, radiusY: nextRadius };
  }

  const nextRadiusX = Math.max(5, node.radiusX() * scaleX);
  const nextRadiusY = Math.max(5, node.radiusY() * scaleY);
  node.setAttrs({
    radiusX: nextRadiusX,
    radiusY: nextRadiusY,
    scaleX: 1,
    scaleY: 1,
  });
  return { radiusX: nextRadiusX, radiusY: nextRadiusY };
}

function onTransform(e: KonvaEvent) {
  const node = e.target as Konva.Ellipse;
  syncNodeGeometry(node);
}

function onTransformEnd(e: KonvaEvent) {
  const node = e.target as Konva.Ellipse;
  const { radiusX, radiusY } = syncNodeGeometry(node);

  const updated = withUpdatedTimestamp({
    x: node.x(),
    y: node.y(),
    radiusX,
    radiusY,
    // 後方互換のため、正円時のフォールバック値としてradiusも更新しておく
    radius: Math.max(radiusX, radiusY),
  });
  emit('update', updated);
  endInteraction(updated);
}
</script>

<style scoped lang="scss">
// Konvaコンポーネントはスタイル不要
</style>
