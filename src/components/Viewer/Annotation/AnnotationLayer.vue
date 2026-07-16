<template>
  <div v-show="editorStore.visibleAnnotations" class="annotation-layer-wrapper">
    <v-stage
      ref="stageRef"
      :config="canvasSize"
      @mousedown="handleMouseDown"
      @mousemove="handleMouseMove"
      @mouseup="handleMouseUp"
      @dblclick="handleDblClick"
      :style="{ cursor: cursor }"
    >
      <v-layer>
        <component
          v-for="annotation in visibleAnnotations"
          :key="annotation.id"
          :is="ANNOTATION_REGISTRY[annotation.type].component"
          :ref="(el: unknown) => setAnnotationRef(annotation.id, el)"
          :annotation="annotation"
          :is-editing="isEditing"
          :is-selected="selectedAnnotIds.includes(annotation.id)"
          @update="onRegisterAnnot"
          @delete="onRemoveAnnot"
        />

        <component
          v-if="(isDrawing || !!clickPointsBuffer) && drawingPreviewConfig"
          :is="drawingPreviewComponent"
          :config="drawingPreviewConfig"
        />
        <v-rect v-if="selectionBox.visible" :config="selectionBoxConfig" />

        <v-transformer
          ref="transformerRef"
          v-if="isEditingMode && selectedTransformableIds.length > 0"
          :config="transformerConfig"
        />
      </v-layer>
    </v-stage>

    <!-- テキストボックスのインライン編集用オーバーレイ（Konvaの外、通常のDOM要素として重ねる） -->
    <textarea
      v-if="editingTextAnnotation"
      ref="textareaRef"
      v-model="editingTextValue"
      :style="editingTextStyle"
      @blur="commitTextEdit"
      @keydown.esc="cancelTextEdit"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type Konva from 'konva';
import dayjs from 'dayjs';
import { createAnnotationFromPoints, startDrawingAnnotation } from './annotationDrawingManager';
import { useEditorStore } from 'src/stores/editorStore';
import type { AnnotationID, AnnotationStyle, TextAnnotationStyle } from 'src/models/document/pdf';
import { ANNOTATION_GEOMETRY, type ClickPointsDrawModule, type Point } from 'src/services/document/annotationGeometry';
import { ANNOTATION_REGISTRY } from './registry';

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
const selectedAnnotIds = defineModel<AnnotationID[]>('selectedAnnotIds', { required: true });

const stageRef = ref<{ getNode: () => Konva.Stage | null } | null>(null);
const transformerRef = ref<{ getNode: () => Konva.Transformer | null } | null>(null);
// アノテーションIDごとのコンポーネントハンドル。種別ごとの配列(boxRefs等)を廃止し、単一のMapに統一する
const annotationRefs = new Map<AnnotationID, AnnotationNodeHandle>();
function setAnnotationRef(id: AnnotationID, el: unknown) {
  const handle = el as AnnotationNodeHandle | null;
  if (handle) {
    annotationRefs.set(id, handle);
  } else {
    annotationRefs.delete(id);
  }
}
const pendingPointerTarget = ref<{ id: string; wasSelected: boolean } | null>(null);

const isDrawing = ref(false);
const isSelecting = ref(false);
const startPos = ref<{ x: number; y: number } | null>(null);
const selectionStartPos = ref<{ x: number; y: number } | null>(null);
const selectionBox = ref({ visible: false, x: 0, y: 0, width: 0, height: 0 });
const selectionModeRef = ref<'window' | 'cross' | null>(null);
const drawingPreviewConfig = ref<Record<string, unknown> | null>(null);
// クリックで頂点を置いていく方式（折れ線・ポリゴン）の描画中バッファ
const clickPointsBuffer = ref<Point[] | null>(null);
// テキストボックスのインライン編集状態
const editingTextId = ref<AnnotationID | null>(null);
const editingTextValue = ref('');
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const drawingType = computed(() => editorStore.currentTools);
const drawingPreviewComponent = computed(() => {
  if (!(drawingType.value in ANNOTATION_REGISTRY)) return null;
  return ANNOTATION_REGISTRY[drawingType.value as AnnotationStyle['type']].previewComponent;
});
const isDrawingTool = computed(() => drawingType.value in ANNOTATION_REGISTRY);
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

// ポリゴンの始点を再クリックしたとみなす画面上の許容距離（px）
const CLOSE_THRESHOLD_PX = 10;

const editingTextAnnotation = computed<TextAnnotationStyle | null>(() => {
  if (!editingTextId.value) return null;
  const found = props.annotations.find((a) => a.id === editingTextId.value);
  return found && found.type === 'text' ? found : null;
});

// テキスト編集中のアノテーションはKonva側の描画から除外する。
// <textarea>オーバーレイに表示は完全に一任し、確定前の古いテキストが背後に二重表示されるのを防ぐ
const visibleAnnotations = computed(() =>
  editingTextId.value ? props.annotations.filter((a) => a.id !== editingTextId.value) : props.annotations,
);

const editingTextStyle = computed(() => {
  const annotation = editingTextAnnotation.value;
  if (!annotation) return {};
  const s = scale.value;
  return {
    position: 'absolute' as const,
    left: `${annotation.x * s}px`,
    top: `${annotation.y * s}px`,
    width: `${annotation.width * s}px`,
    height: `${annotation.height * s}px`,
    margin: 0,
    zIndex: 20,
    fontFamily: annotation.fontFamily,
    fontSize: `${annotation.fontSize * s}px`,
    // Konva側の描画（fontStyle: 'bold' | 'normal'）と一致させるため、数値のfontWeightではなく
    // 同じ二値判定でbold/normalに変換する（そうしないと編集中と確定時で太さの見え方がズレる）
    fontWeight: annotation.fontWeight >= 700 ? 'bold' : 'normal',
    lineHeight: 1.2,
    color: annotation.textColor,
    textAlign: annotation.textAlign,
    background: annotation.fillColor ?? 'transparent',
    // strokeWidth未指定/0（デフォルト状態）でもTextBoxAnnotation.vue側の描画と同じく細い枠線を表示する
    border: `${(annotation.strokeWidth || 1) * s}px solid ${annotation.color}`,
    padding: `${4 * s}px`,
    boxSizing: 'border-box' as const,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    resize: 'none' as const,
    outline: 'none' as const,
    overflow: 'hidden' as const,
  };
});

function startTextEdit(annotation: TextAnnotationStyle) {
  editingTextId.value = annotation.id;
  editingTextValue.value = annotation.text;
  selectedAnnotIds.value = [annotation.id];
  void nextTick(() => textareaRef.value?.focus());
}

function commitTextEdit() {
  const annotation = editingTextAnnotation.value;
  editingTextId.value = null;
  if (!annotation) return;
  if (annotation.text === editingTextValue.value) return;

  void props.onRegisterAnnot({
    ...annotation,
    text: editingTextValue.value,
    updatedAt: dayjs().toISOString(),
  });
}

function cancelTextEdit() {
  editingTextId.value = null;
}

function handleDblClick(e: KonvaMouseEvent) {
  if (clickPointsBuffer.value) {
    // ダブルクリックを構成する2回のmousedownで追加された頂点を取り除いてから確定する
    // （そうしないと確定位置にも頂点が打たれてしまう）
    clickPointsBuffer.value = clickPointsBuffer.value.slice(0, -1);
    finishClickPointsDrawing();
    return;
  }

  if (drawingType.value !== 'pointer') return;
  const clickedId = e.target.attrs?.id as AnnotationID | undefined;
  if (!clickedId) return;

  const annotation = props.annotations.find((a) => a.id === clickedId);
  if (!annotation) return;
  if (!ANNOTATION_REGISTRY[annotation.type].supportsInlineTextEdit) return;
  if (annotation.type !== 'text') return;

  startTextEdit(annotation);
}

function updateClickPointsPreview(cursorPos: Point | null) {
  if (!clickPointsBuffer.value) return;
  const style = editorStore.currentAnnotationStyle;
  if (!(style.type in ANNOTATION_GEOMETRY)) return;

  const module = ANNOTATION_GEOMETRY[style.type];
  if (module.drawMode !== 'clickPoints') return;

  drawingPreviewConfig.value = module.previewFromPoints(clickPointsBuffer.value, cursorPos, style);
}

function handleClickPointsMouseDown(pos: Point, geometry: ClickPointsDrawModule<AnnotationStyle>) {
  selectedAnnotIds.value = [];

  if (!clickPointsBuffer.value) {
    clickPointsBuffer.value = [pos];
    updateClickPointsPreview(pos);
    return;
  }

  const origin = clickPointsBuffer.value[0];
  if (origin) {
    const screenDistance = Math.hypot(pos.x - origin.x, pos.y - origin.y) * scale.value;
    if (geometry.closable && clickPointsBuffer.value.length >= 3 && screenDistance <= CLOSE_THRESHOLD_PX) {
      finishClickPointsDrawing();
      return;
    }
  }

  clickPointsBuffer.value = [...clickPointsBuffer.value, pos];
  updateClickPointsPreview(pos);
}

function finishClickPointsDrawing() {
  if (!clickPointsBuffer.value) return;
  const style = editorStore.currentAnnotationStyle;
  const points = clickPointsBuffer.value;
  clickPointsBuffer.value = null;
  drawingPreviewConfig.value = null;

  const annotation = createAnnotationFromPoints(page.value, points, style);
  if (annotation) {
    void props.onRegisterAnnot(annotation);
  }
}

function cancelClickPointsDrawing() {
  clickPointsBuffer.value = null;
  drawingPreviewConfig.value = null;
}

// ツール切替時に未完了のクリック頂点バッファを破棄する。
// 放置すると幽霊プレビューが残ったり、その後ポインタツールでのダブルクリックが
// 切替前のスタイルで意図しないアノテーションを確定させてしまう
watch(drawingType, () => {
  if (clickPointsBuffer.value) cancelClickPointsDrawing();
});

function handleKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  if (clickPointsBuffer.value) {
    cancelClickPointsDrawing();
  }
}

onMounted(() => window.addEventListener('keydown', handleKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown));

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
  if (!(drawingType.value in ANNOTATION_REGISTRY)) return;

  const module = ANNOTATION_REGISTRY[drawingType.value];

  if (module.geometry.drawMode === 'clickPoints') {
    // 頂点追加中は既存シェイプの上でもクリックを継続として扱う。新規開始は空白領域のみ
    if (!clickPointsBuffer.value && e.target !== stage) return;

    const pos = stage.getPointerPosition();
    if (!pos) return;
    const adjustedPos = { x: pos.x / scale.value, y: pos.y / scale.value };
    handleClickPointsMouseDown(adjustedPos, module.geometry);
    return;
  }

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
  if (clickPointsBuffer.value) {
    const stage = e.target?.getStage();
    if (!stage) return;

    const pos = stage.getPointerPosition();
    if (!pos) return;

    updateClickPointsPreview({ x: pos.x / scale.value, y: pos.y / scale.value });
    return;
  }

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
    drawingPreviewConfig.value = null;

    if (endDrawingAnnotation) {
      const annotation = endDrawingAnnotation(adjustedPos.x, adjustedPos.y);
      if (annotation) {
        const shouldStartTextEdit = ANNOTATION_REGISTRY[annotation.type].supportsInlineTextEdit;
        void props.onRegisterAnnot(annotation).then(() => {
          if (shouldStartTextEdit && annotation.type === 'text') startTextEdit(annotation);
        });
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
    const selectedIds = Array.from(annotationRefs.values())
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

  const style = editorStore.currentAnnotationStyle;
  if (!(style.type in ANNOTATION_GEOMETRY)) return;

  const module = ANNOTATION_GEOMETRY[style.type];
  if (module.drawMode !== 'drag') return;

  drawingPreviewConfig.value = module.previewFromDrag(startPos.value, { x: endX, y: endY }, style);
}

function syncTransformerSelection() {
  const transformer = transformerRef.value?.getNode();
  if (!transformer) return;

  const nodes = selectedTransformableIds.value
    .filter((id) => {
      const annotation = props.annotations.find((a) => a.id === id);
      return annotation !== undefined && ANNOTATION_REGISTRY[annotation.type].supportsTransformer;
    })
    .map((id) => annotationRefs.get(id)?.getNode())
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
