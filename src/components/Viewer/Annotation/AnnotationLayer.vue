<template>
  <div v-show="editorStore.visibleAnnotations" class="annotation-layer-wrapper">
    <v-stage
      ref="stageRef"
      :config="canvasSize"
      @mousedown="handleMouseDown"
      @mousemove="handleMouseMove"
      @mouseup="handleMouseUp"
      :style="{ cursor: cursor }"
    >
      <v-layer>
        <template v-for="annotation in annotations" :key="annotation.id">
          <BoxAnnotation
            v-if="annotation.type === 'box'"
            ref="boxRefs"
            :annotation="annotation"
            :is-editing="isEditing"
            :is-selected="selectedAnnotIds.includes(annotation.id)"
            @update="onRegisterAnnot"
            @delete="onRemoveAnnot"
          />

          <LineAnnotation
            v-else-if="annotation.type === 'line'"
            ref="lineRefs"
            :annotation="annotation"
            :is-editing="isEditing"
            :is-selected="selectedAnnotIds.includes(annotation.id)"
            @update="onRegisterAnnot"
            @delete="onRemoveAnnot"
          />

          <CircleAnnotation
            v-else-if="annotation.type === 'circle'"
            ref="circleRefs"
            :annotation="annotation"
            :is-editing="isEditing"
            :is-selected="selectedAnnotIds.includes(annotation.id)"
            @update="onRegisterAnnot"
            @delete="onRemoveAnnot"
          />
        </template>

        <v-rect
          v-if="isDrawing && drawingPreview && drawingType === 'box'"
          :config="drawingPreview.rect"
        />
        <v-line
          v-if="isDrawing && drawingPreview && drawingType === 'line'"
          :config="drawingPreview.line"
        />
        <v-circle
          v-if="isDrawing && drawingPreview && drawingType === 'circle'"
          :config="drawingPreview.circle"
        />
        <v-rect v-if="selectionBox.visible" :config="selectionBoxConfig" />

        <v-transformer
          ref="transformerRef"
          v-if="isEditingMode && selectedTransformableIds.length > 0"
          :config="transformerConfig"
        />
      </v-layer>
    </v-stage>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import BoxAnnotation from './BoxAnnotation.vue';
import LineAnnotation from './LineAnnotation.vue';
import CircleAnnotation from './CircleAnnotation.vue';
import type Konva from 'konva';
import { startDrawingAnnotation } from './annotationDrawingManager';
import { useEditorStore } from 'src/stores/editorStore';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';

type KonvaMouseEvent = Konva.KonvaEventObject<MouseEvent>;
type AnnotationNodeHandle = { getNode: () => Konva.Node | null };

interface Props {
  annotations: AnnotationStyle[];
  onRegisterAnnot: (annot: AnnotationStyle) => Promise<void>;
  onRemoveAnnot: (annotID: AnnotationID) => Promise<void>;
}

const props = defineProps<Props>();
const editorStore = useEditorStore();

const page = defineModel<number>('page', { required: true });
const canvasSize = defineModel<{ width: number; height: number }>('canvasSize', { required: true });
const scale = defineModel<number>('scale', { required: true });
const selectedAnnotIds = defineModel<AnnotationID[]>('selectedAnnotIds', { required: true })

const stageRef = ref<{ getNode: () => Konva.Stage | null } | null>(null);
const transformerRef = ref<{ getNode: () => Konva.Transformer | null } | null>(null);
const boxRefs = ref<AnnotationNodeHandle[]>([]);
const lineRefs = ref<AnnotationNodeHandle[]>([]);
const circleRefs = ref<AnnotationNodeHandle[]>([]);
const pendingPointerTarget = ref<{ id: string; wasSelected: boolean } | null>(null);

const isDrawing = ref(false);
const isSelecting = ref(false);
const startPos = ref<{ x: number; y: number } | null>(null);
const selectionStartPos = ref<{ x: number; y: number } | null>(null);
const selectionBox = ref({ visible: false, x: 0, y: 0, width: 0, height: 0 });
const selectionModeRef = ref<'window' | 'cross' | null>(null);
const drawingPreview = ref<{
  rect?: {
    x: number;
    y: number;
    width: number;
    height: number;
    fill: string;
    opacity: number;
    stroke?: string;
    strokeWidth?: number;
  };
  line?: { x: number; y: number; points: number[]; stroke: string; strokeWidth: number };
  circle?: { x: number; y: number; radius: number; stroke: string; strokeWidth: number };
} | null>(null);
const drawingType = computed(() => editorStore.currentTools);
const isDrawingTool = computed(() => ['box', 'line', 'circle'].includes(drawingType.value));
// 編集は明示的な 'hand'（読み取り専用）モード以外で許可されます。
const isEditingMode = computed(() => drawingType.value !== 'hand');
const isEditing = computed(() => isEditingMode.value);
// カーソル状態はモードに基づき動的に変化します。編集可能な注釈上にホバーした場合は切り替わります。
const cursor = ref('default');
watch(isDrawingTool, (v) => {
  cursor.value = v ? 'crosshair' : 'default';
});
const transformerConfig = computed(() => ({
  ignoreStroke: true,
  rotationSnaps: [
    -180, -150, -120, -90, -60, -45, -30, -15, 0, 15, 30, 45, 60, 90, 120, 135, 150, 180, 270,
  ],
  rotationSnapTolerance: 30,
}));
const selectedTransformableIds = computed(() =>
  props.annotations
    .filter((annotation) => selectedAnnotIds.value.includes(annotation.id))
    .map((annotation) => annotation.id),
);

const selectionBoxConfig = computed(() => {
  const isWindow = selectionModeRef.value === 'window';
  const fill = isWindow ? 'rgba(33, 150, 243, 0.15)' : 'rgba(76, 175, 80, 0.15)';
  const stroke = isWindow ? '#2196f3' : '#4caf50';
  return {
    x: selectionBox.value.x,
    y: selectionBox.value.y,
    width: selectionBox.value.width,
    height: selectionBox.value.height,
    fill,
    stroke,
    strokeWidth: 1,
    listening: false,
  };
});

let endDrawingAnnotation: ((endX: number, endY: number) => AnnotationStyle | null) | undefined;

type SelectionMode = 'window' | 'cross';

function getSelectionMode(startX: number, endX: number): SelectionMode {
  return endX >= startX ? 'window' : 'cross';
}

function handleMouseDown(e: KonvaMouseEvent) {
  if (isDrawing.value || isSelecting.value) return;

  const stage = e.target.getStage();
  if (!stage) return;

  // ポインタモード: ステージ上の窓選択（空白領域をドラッグ）と、
  // 注釈をクリックしたままドラッグする単一操作（クリック→ドラッグ）にも対応します。
  if (drawingType.value === 'pointer') {
    const pos = stage.getPointerPosition();
    if (!pos) return;

    // 空白領域をクリックした場合 -> 選択矩形を開始します（ステージ座標で扱うため scale で割らない）
    if (e.target === stage) {
      pendingPointerTarget.value = null;
      isSelecting.value = true;
      selectionStartPos.value = { x: pos.x, y: pos.y };
      selectionBox.value = { visible: true, x: pos.x, y: pos.y, width: 0, height: 0 };
      return;
    }

    // アンカーをクリックした場合は元の注釈 ID を参照します。
    const clickedId =
      e.target.attrs?.name === 'annotation-anchor'
        ? e.target.attrs?.annotationId
        : e.target.attrs?.id;
    if (clickedId) {
      const metaPressed = e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey;
      const isSelected = selectedAnnotIds.value.includes(clickedId);
      pendingPointerTarget.value = { id: clickedId, wasSelected: isSelected };

      if (!metaPressed && !isSelected) {
        selectedAnnotIds.value = [clickedId];
      } else if (metaPressed && isSelected) {
        selectedAnnotIds.value = selectedAnnotIds.value.filter((id) => id !== clickedId);
      } else if (metaPressed && !isSelected) {
        selectedAnnotIds.value = [...selectedAnnotIds.value, clickedId];
      }

      // クリックした形状を即時にドラッグ開始し、1回の操作で押しながら移動できるようにします。
      // e.target.startDrag(e.evt);
    }
    return;
  }

  if (!isEditing.value || drawingType.value === 'hand') return;
  if (e.target !== stage) return;

  const pos = stage.getPointerPosition();
  if (!pos) return;

  // 描画時はドキュメント座標に変換するため scale で割ります
  const adjustedPos = {
    x: pos.x / scale.value,
    y: pos.y / scale.value,
  };

  isDrawing.value = true;
  startPos.value = adjustedPos;
  selectedAnnotIds.value = [];
  endDrawingAnnotation = startDrawingAnnotation(
    page.value,
    adjustedPos.x,
    adjustedPos.y,
    editorStore.currentAnnotationStyle,
  );
  updateDrawingPreview(adjustedPos.x, adjustedPos.y);
}

function handleMouseMove(e: KonvaMouseEvent) {
  if (isDrawing.value && startPos.value) {
    const stage = e.target?.getStage();
    if (!stage) return;

    const pos = stage.getPointerPosition();
    if (!pos) return;

    const adjustedPos = {
      x: pos.x / scale.value,
      y: pos.y / scale.value,
    };

    updateDrawingPreview(adjustedPos.x, adjustedPos.y);
    return;
  }
  // カーソル制御: 描画モード中でも編集可能な注釈上にホバーしていれば選択用カーソルに切り替えます
  const overAnnot = e.target !== e.target.getStage() && Boolean(e.target.attrs?.id);
  // アンカ（端点）上なら掴む系カーソルを表示
  const isAnchor = e.target !== e.target.getStage() && e.target.attrs?.name === 'annotation-anchor';
  if (isAnchor) {
    cursor.value = 'grab';
  } else if (isDrawingTool.value) {
    cursor.value = overAnnot && isEditing.value ? 'default' : 'crosshair';
  } else {
    cursor.value = overAnnot ? 'default' : 'default';
  }

  if (!isSelecting.value || !selectionStartPos.value) return;

  const stage = e.target?.getStage();
  if (!stage) return;

  const pos = stage.getPointerPosition();
  if (!pos) return;

  // ドラッグ方向に基づいて選択モード（窓 vs 交差）を判定します
  const mode = getSelectionMode(selectionStartPos.value.x, pos.x);
  selectionModeRef.value = mode;

  // 選択矩形はステージのピクセル座標で扱います（scale で割らない）
  selectionBox.value = {
    visible: true,
    x: Math.min(selectionStartPos.value.x, pos.x),
    y: Math.min(selectionStartPos.value.y, pos.y),
    width: Math.abs(pos.x - selectionStartPos.value.x),
    height: Math.abs(pos.y - selectionStartPos.value.y),
  };
}

function handleMouseUp(e: KonvaMouseEvent) {
  if (isDrawing.value && startPos.value) {
    const stage = e.target?.getStage();
    if (!stage) return;

    const pos = stage.getPointerPosition();
    if (!pos) return;

    const adjustedPos = {
      x: pos.x / scale.value,
      y: pos.y / scale.value,
    };

    isDrawing.value = false;
    drawingPreview.value = null;

    if (endDrawingAnnotation) {
      const annotation = endDrawingAnnotation(adjustedPos.x, adjustedPos.y);
      if (annotation) {
        void props.onRegisterAnnot(annotation);
      }
    }

    startPos.value = null;
    pendingPointerTarget.value = null;
    return;
  }

  if (!isSelecting.value || !selectionStartPos.value) {
    pendingPointerTarget.value = null;
    return;
  }

  const stage = e.target?.getStage();
  if (!stage) return;

  const pos = stage.getPointerPosition();
  if (!pos) return;

  // 選択判定の比較にもステージのピクセル座標を使用します（scale で割らない）
  const selectionMode = getSelectionMode(selectionStartPos.value.x, pos.x);
  const selectionRect = {
    x: Math.min(selectionStartPos.value.x, pos.x),
    y: Math.min(selectionStartPos.value.y, pos.y),
    width: Math.abs(pos.x - selectionStartPos.value.x),
    height: Math.abs(pos.y - selectionStartPos.value.y),
  };

  if (selectionRect.width > 0 && selectionRect.height > 0) {
    const refs = [...boxRefs.value, ...lineRefs.value, ...circleRefs.value];
    const selectedIds = refs
      .map((ref) => ref.getNode())
      .filter((node): node is Konva.Node => Boolean(node))
      .map((node) => {
        // node.getClientRect はステージ座標での外接矩形を返す
        const rect = node.getClientRect();

        // 窓選択（window）は矩形が完全に選択領域に含まれることを要求する
        if (selectionMode === 'window') {
          const epsilon = 0.5; // 浮動小数点誤差を吸収する許容値
          const contained =
            rect.x + epsilon >= selectionRect.x &&
            rect.y + epsilon >= selectionRect.y &&
            rect.x + rect.width <= selectionRect.x + selectionRect.width + epsilon &&
            rect.y + rect.height <= selectionRect.y + selectionRect.height + epsilon;
          return contained ? (node.attrs.id as string) : null;
        }

        // 交差選択（cross）は少しでも重なっていれば選択
        const intersects = !(
          rect.x + rect.width < selectionRect.x ||
          rect.x > selectionRect.x + selectionRect.width ||
          rect.y + rect.height < selectionRect.y ||
          rect.y > selectionRect.y + selectionRect.height
        );
        return intersects ? (node.attrs.id as string) : null;
      })
      .filter(Boolean) as AnnotationID[];

    const metaPressed = e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey;
    if (!metaPressed) {
      selectedAnnotIds.value = selectedIds;
    } else {
      selectedAnnotIds.value = [...new Set([...selectedAnnotIds.value, ...selectedIds])];
    }
  } else {
    // 単純なアノテーション以外の箇所のクリックの場合は選択を解除する
    selectedAnnotIds.value = [];
  }

  // 選択表示を隠してモードをリセットします
  selectionBox.value = { visible: false, x: 0, y: 0, width: 0, height: 0 };
  selectionStartPos.value = null;
  selectionModeRef.value = null;
  isSelecting.value = false;
  pendingPointerTarget.value = null;
}

function updateDrawingPreview(endX: number, endY: number) {
  if (!startPos.value) return;

  const deltaX = endX - startPos.value.x;
  const deltaY = endY - startPos.value.y;

  const style = editorStore.currentAnnotationStyle;
  if (style.type === 'box') {
    drawingPreview.value = {
      rect: {
        x: Math.min(startPos.value.x, endX),
        y: Math.min(startPos.value.y, endY),
        width: Math.abs(deltaX),
        height: Math.abs(deltaY),
        fill: 'transparent',
        opacity: style.fillOpacity,
        stroke: style.strokeColor,
        strokeWidth: style.strokeWidth,
      },
    };
  } else if (style.type === 'line') {
    drawingPreview.value = {
      line: {
        x: startPos.value.x,
        y: startPos.value.y,
        points: [0, 0, deltaX, deltaY],
        stroke: style.strokeColor,
        strokeWidth: style.strokeWidth,
      },
    };
  } else if (style.type === 'circle') {
    const radius = Math.sqrt(deltaX * deltaX + deltaY * deltaY) / 2;
    drawingPreview.value = {
      circle: {
        x: startPos.value.x + deltaX / 2,
        y: startPos.value.y + deltaY / 2,
        radius,
        stroke: style.strokeColor,
        strokeWidth: style.strokeWidth,
      },
    };
  }
}

function syncTransformerSelection() {
  const transformer = transformerRef.value?.getNode();
  if (!transformer) return;

  const refs = [...boxRefs.value, ...circleRefs.value];
  const nodes = selectedTransformableIds.value
    .map((id) => refs.find((ref) => ref.getNode()?.attrs.id === id)?.getNode())
    .filter((node): node is Konva.Node => Boolean(node));

  transformer.nodes(nodes);
}

watch(
  selectedAnnotIds,
  () => {
    void nextTick(syncTransformerSelection);
  },
  { flush: 'post', deep: true },
);
</script>

<style scoped lang="scss">
.annotation-layer-wrapper {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 10;
  width: 100%;
  height: 100%;
}
</style>
