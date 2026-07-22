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
          :allow-drag="canDragUnselected"
          @update="onRegisterAnnot"
          @delete="onRemoveAnnot"
        />

        <component
          v-if="(isDrawing || !!clickPointsBuffer) && drawingPreviewConfig"
          :is="drawingPreviewComponent"
          :config="drawingPreviewConfig"
        />
        <!-- 多角形描画中、始点位置を示す小さな円（始点をクリックすると閉合できることが分かるように） -->
        <v-circle v-if="startVertexIndicatorConfig" :config="startVertexIndicatorConfig" />
        <v-rect v-if="selectionBox.visible" :config="selectionBoxConfig" />

        <!-- Ctrl+drag複製のプレビュー: 複製元は一切変更せず、ドラッグ解除位置に複製されるまでの
             見た目上のプレビューのみをここに重ねて表示する（非対話・半透明） -->
        <v-group v-if="duplicatePreviewAnnotation" :config="{ opacity: 0.55, listening: false }">
          <component
            :is="ANNOTATION_REGISTRY[duplicatePreviewAnnotation.type].component"
            :annotation="duplicatePreviewAnnotation"
            :is-editing="false"
            :is-selected="false"
            :allow-drag="false"
          />
        </v-group>

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
import {
  ANNOTATION_GEOMETRY,
  duplicateAnnotation,
  type ClickPointsDrawModule,
  type Point,
} from 'src/services/document/annotationGeometry';
import { ANNOTATION_REGISTRY } from './registry';
import { getAnnotationSortKey } from 'src/utils/document/annotationOrder';

type KonvaMouseEvent = Konva.KonvaEventObject<MouseEvent>;
type AnnotationNodeHandle = { getNode: () => Konva.Node | null };

interface Props {
  annotations: AnnotationStyle[];
  // Konvaステージの座標系のスケール（PdfPage側で解像度上限にクランプされた「実描画スケール」）。
  // 見た目上のズーム倍率そのものではない点に注意（PdfPage.vueのrenderScaleを参照）
  scale: number;
  onRegisterAnnot: (annot: AnnotationStyle) => Promise<void>;
  onRemoveAnnot: (annotID: AnnotationID) => Promise<void>;
}

const props = defineProps<Props>();
const editorStore = useEditorStore();

const page = defineModel<number>('page', { required: true });
const canvasSize = defineModel<{ width: number; height: number }>('canvasSize', { required: true });
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

// Ctrl+drag複製: マウスダウン時点ではクリックなのかドラッグなのか確定しないため、
// 実際にしきい値を超えて動いた時点で初めて複製プレビューへ昇格させる（昇格しなければ
// 単なるCtrl+クリックとして選択解除を適用する）
const DUPLICATE_DRAG_THRESHOLD_PX = 3;
const ctrlDragCandidate = ref<{ id: AnnotationID; stagePos: { x: number; y: number } } | null>(
  null,
);
const duplicateDragSource = ref<AnnotationStyle | null>(null);
const duplicateDragStageStart = ref<{ x: number; y: number } | null>(null);
const duplicateDragOffsetDoc = ref<Point>({ x: 0, y: 0 });
// 複製元は一切変更せず、ドラッグ位置に追従する見た目上のプレビューのみを別途描画する
const duplicatePreviewAnnotation = computed<AnnotationStyle | null>(() => {
  const source = duplicateDragSource.value;
  if (!source) return null;
  return {
    ...source,
    x: source.x + duplicateDragOffsetDoc.value.x,
    y: source.y + duplicateDragOffsetDoc.value.y,
  };
});

const isDrawing = ref(false);
const isSelecting = ref(false);
const startPos = ref<{ x: number; y: number } | null>(null);
const selectionStartPos = ref<{ x: number; y: number } | null>(null);
const selectionBox = ref({ visible: false, x: 0, y: 0, width: 0, height: 0 });
const selectionModeRef = ref<'window' | 'cross' | null>(null);
const drawingPreviewConfig = ref<Record<string, unknown> | null>(null);
// クリックで頂点を置いていく方式（折れ線・ポリゴン・line・text）の描画中バッファ
const clickPointsBuffer = ref<Point[] | null>(null);
// clickPoints方式で最初の頂点を置いた時点のステージ座標（画面px）。
// maxPoints=2の種別（line/text）で「押したままドラッグ→離す」操作を検出するために使う
const clickPointsStartScreenPos = ref<{ x: number; y: number } | null>(null);
// 描画ツール使用中、既存アノテーションのシェイプ上でmousedownした際の曖昧開始状態。
// 実際にドラッグへ発展すればその場から新規描画を開始し、発展せず単なるクリックで終われば
// 既存アノテーションの選択編集として扱う（どちらの意図かはmouseup/mousemoveで確定する）
const pendingOverAnnotStart = ref<{
  id: AnnotationID;
  screenPos: { x: number; y: number };
  docPos: Point;
} | null>(null);
// テキストボックスのインライン編集状態
const editingTextId = ref<AnnotationID | null>(null);
const editingTextValue = ref('');
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const drawingType = computed(() => editorStore.currentTools);
// ポインタ（選択）モードでのみ、未選択のアノテーションでも即座にドラッグ移動できるようにする。
// 描画モード中は常にfalseにし、既存アノテーション上での曖昧開始（クリック=選択・ドラッグ=新規描画。
// pendingOverAnnotStart参照）と競合しないようにする
const canDragUnselected = computed(() => drawingType.value === 'pointer');
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
watch(
  drawingType,
  (type) => {
    if (type === 'hand') cursor.value = 'grab';
    else if (type in ANNOTATION_REGISTRY) cursor.value = 'crosshair';
    else cursor.value = 'default';
  },
  { immediate: true },
);
const transformerConfig = computed(() => ({
  ignoreStroke: true,
  rotationSnaps: [
    -180, -150, -120, -90, -60, -45, -30, -15, 0, 15, 30, 45, 60, 90, 120, 135, 150, 180, 270,
  ],
  rotationSnapTolerance: 30,
  // コーナードラッグは既定で自由変形にする（要件5）。Konva標準の`keepRatio() || e.shiftKey`により、
  // Shift押下時のみ縦横比維持に自動的に切り替わる（要件6。追加実装不要）
  keepRatio: false,
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
  // selectionBox自体はステージのピクセル座標（scale未適用）で保持しているが、
  // 描画先のv-stageにはscaleX/scaleY（canvasSize参照）が設定されており、
  // その中に配置するシェイプの座標は他の描画と同様にドキュメント座標系（scale適用前）で
  // 指定する必要がある。ここで割らずにそのまま渡すと、ズーム時にscaleが二重適用され、
  // マウス位置から選択矩形がずれて表示されてしまう
  return {
    x: selectionBox.value.x / props.scale,
    y: selectionBox.value.y / props.scale,
    width: selectionBox.value.width / props.scale,
    height: selectionBox.value.height / props.scale,
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
// <textarea>オーバーレイに表示は完全に一任し、確定前の古いテキストが背後に二重表示されるのを防ぐ。
// 重ね順（zIndex未設定の場合はcreatedAt）の昇順で並べることで、後に描画される＝手前に表示される
const visibleAnnotations = computed(() => {
  const filtered = editingTextId.value
    ? props.annotations.filter((a) => a.id !== editingTextId.value)
    : props.annotations;
  return [...filtered].sort((a, b) => getAnnotationSortKey(a) - getAnnotationSortKey(b));
});

const editingTextStyle = computed(() => {
  const annotation = editingTextAnnotation.value;
  if (!annotation) return {};
  const s = props.scale;
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
  // フォーカスは下のwatch(editingTextAnnotation)に一任する。
  // 描き終えた直後は`props.annotations`（DB購読経由）へ新規注釈がまだ反映されておらず、
  // ここで直接focusしても<textarea v-if>が実際にマウントされる前で失敗することがあるため
}

// <textarea>が実際にマウントされたタイミング（editingTextAnnotationがnull→非nullに変わった時）で
// 確実にフォーカスする。startTextEdit呼び出し直後は`props.annotations`（DB購読経由）へ新規注釈が
// まだ反映されておらず要素が存在しないことがあるため、単発のnextTickでは取りこぼすことがあった
watch(editingTextAnnotation, (annotation) => {
  if (!annotation) return;
  void nextTick(() => textareaRef.value?.focus());
});

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

// 多角形（closable=trueの種別）描画中のみ、始点位置を示す小さな円を出す。
// 頂点追加中は既存シェイプの上でもクリックを継続として扱う都合上、視覚的に「ここが始点」と
// 分かるようにしておくことで、始点への再クリックによる閉合操作が発見しやすくなる
const startVertexIndicatorConfig = computed(() => {
  if (!clickPointsBuffer.value || clickPointsBuffer.value.length === 0) return null;
  const style = editorStore.currentAnnotationStyle;
  if (!(style.type in ANNOTATION_GEOMETRY)) return null;

  const module = ANNOTATION_GEOMETRY[style.type];
  if (module.drawMode !== 'clickPoints' || !module.closable) return null;

  const origin = clickPointsBuffer.value[0];
  if (!origin) return null;

  return {
    x: origin.x,
    y: origin.y,
    radius: 5,
    fill: '#ffffff',
    stroke: style.strokeColor,
    strokeWidth: 2,
    listening: false,
  };
});

function updateClickPointsPreview(cursorPos: Point | null) {
  if (!clickPointsBuffer.value) return;
  const style = editorStore.currentAnnotationStyle;
  if (!(style.type in ANNOTATION_GEOMETRY)) return;

  const module = ANNOTATION_GEOMETRY[style.type];
  if (module.drawMode !== 'clickPoints') return;

  // 始点付近にカーソルがあり、今クリックすれば閉合確定できる状態かどうか
  // （handleClickPointsMouseDownの閉合判定と同じ距離・条件で判定する）
  const origin = clickPointsBuffer.value[0];
  const closing =
    module.closable && clickPointsBuffer.value.length >= 3 && !!cursorPos && !!origin
      ? Math.hypot(cursorPos.x - origin.x, cursorPos.y - origin.y) * props.scale <=
        CLOSE_THRESHOLD_PX
      : false;

  drawingPreviewConfig.value = module.previewFromPoints(clickPointsBuffer.value, cursorPos, style, {
    closing,
  });
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
    const screenDistance = Math.hypot(pos.x - origin.x, pos.y - origin.y) * props.scale;
    if (
      geometry.closable &&
      clickPointsBuffer.value.length >= 3 &&
      screenDistance <= CLOSE_THRESHOLD_PX
    ) {
      finishClickPointsDrawing();
      return;
    }
  }

  clickPointsBuffer.value = [...clickPointsBuffer.value, pos];

  // line/textのような2点で完成する種別は、始点への再クリックを待たず頂点数到達で即確定する
  if (geometry.maxPoints !== undefined && clickPointsBuffer.value.length >= geometry.maxPoints) {
    finishClickPointsDrawing();
    return;
  }

  updateClickPointsPreview(pos);
}

/**
 * 描画完了後、選択モードへ自動的に戻す（プリセットのダブルクリックでstickyDrawModeが
 * 有効な場合は戻さず、同じツール・スタイルのまま連続して描き続けられるようにする）
 * @returns 実際にポインタモードへ切り替えたかどうか
 */
function returnToPointerModeUnlessSticky(): boolean {
  if (editorStore.stickyDrawMode) return false;
  editorStore.activeAnnotationType = undefined;
  editorStore.currentTools = 'pointer';
  return true;
}

function finishClickPointsDrawing() {
  if (!clickPointsBuffer.value) return;
  const style = editorStore.currentAnnotationStyle;
  const points = clickPointsBuffer.value;
  clickPointsBuffer.value = null;
  clickPointsStartScreenPos.value = null;
  drawingPreviewConfig.value = null;

  const annotation = createAnnotationFromPoints(page.value, points, style);
  if (annotation) {
    const shouldStartTextEdit = ANNOTATION_REGISTRY[annotation.type].supportsInlineTextEdit;
    void props.onRegisterAnnot(annotation).then(() => {
      // 描き終えたら選択モードへ自動的に戻る（テキストは直後にインライン編集へ入るため対象外。
      // プリセットのダブルクリックでstickyDrawModeが有効な場合は戻さず連続して描き続けられるようにする）
      const switchedToPointer = returnToPointerModeUnlessSticky();
      if (shouldStartTextEdit && annotation.type === 'text') {
        startTextEdit(annotation);
      } else if (switchedToPointer) {
        selectedAnnotIds.value = [annotation.id];
      }
    });
  }
}

function cancelClickPointsDrawing() {
  clickPointsBuffer.value = null;
  clickPointsStartScreenPos.value = null;
  drawingPreviewConfig.value = null;
}

// ツール切替時に未完了のクリック頂点バッファ・曖昧開始状態を破棄する。
// 放置すると幽霊プレビューが残ったり、その後ポインタツールでのダブルクリックが
// 切替前のスタイルで意図しないアノテーションを確定させてしまう
watch(drawingType, () => {
  if (clickPointsBuffer.value) cancelClickPointsDrawing();
  pendingOverAnnotStart.value = null;
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

      if (e.evt.ctrlKey && isSelected) {
        // 選択済みの注釈へのCtrl+クリック: この時点ではクリックかドラッグか確定しない。
        // ドラッグへ発展すればCtrl+drag複製として扱い（handleMouseMove/handleMouseUp）、
        // 発展しなければ従来通り選択解除する
        ctrlDragCandidate.value = { id: clickedId, stagePos: { x: pos.x, y: pos.y } };
      } else if (!metaPressed && !isSelected) {
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
  const pos = stage.getPointerPosition();
  if (!pos) return;
  const adjustedPos = { x: pos.x / props.scale, y: pos.y / props.scale };

  // clickPoints方式で頂点追加中（バッファ開始済み）は、既存シェイプの上でもそのまま頂点追加として扱う
  if (module.geometry.drawMode === 'clickPoints' && clickPointsBuffer.value) {
    handleClickPointsMouseDown(adjustedPos, module.geometry);
    return;
  }

  const isOverExistingShape = e.target !== stage && e.target.attrs?.name === 'annotation-shape';
  // アンカー等（ステージでも既存シェイプでもない対象）の上からは新規描画を開始しない
  if (!isOverExistingShape && e.target !== stage) return;

  if (isOverExistingShape) {
    const clickedId = e.target.attrs?.id as AnnotationID | undefined;
    if (!clickedId) return;
    // 曖昧開始: この時点ではクリック（既存注釈の選択編集）かドラッグ（新規描画）か確定しない。
    // 実際の分岐はhandleMouseMove（ドラッグへ発展した場合）・handleMouseUp（発展しなかった場合）で行う
    pendingOverAnnotStart.value = {
      id: clickedId,
      screenPos: { x: pos.x, y: pos.y },
      docPos: adjustedPos,
    };
    return;
  }

  // 空白領域からの通常開始
  if (module.geometry.drawMode === 'clickPoints') {
    // 2点構成の種別（line/text）を「押したままドラッグ→離す」でも描けるよう、
    // 最初の頂点を置いた時点のステージ座標（画面px）を記録しておく（handleMouseUp参照）
    clickPointsStartScreenPos.value = { x: pos.x, y: pos.y };
    handleClickPointsMouseDown(adjustedPos, module.geometry);
    return;
  }

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
  // Ctrl+クリック候補がしきい値を超えて動いたら、複製プレビューへ昇格させる
  if (ctrlDragCandidate.value && !duplicateDragSource.value) {
    const stage = e.target?.getStage();
    const pos = stage?.getPointerPosition();
    if (pos) {
      const candidate = ctrlDragCandidate.value;
      const dx = pos.x - candidate.stagePos.x;
      const dy = pos.y - candidate.stagePos.y;
      if (Math.hypot(dx, dy) > DUPLICATE_DRAG_THRESHOLD_PX) {
        const source = props.annotations.find((a) => a.id === candidate.id);
        ctrlDragCandidate.value = null;
        if (source) {
          duplicateDragSource.value = source;
          duplicateDragStageStart.value = candidate.stagePos;
        }
      }
    }
  }

  if (duplicateDragSource.value && duplicateDragStageStart.value) {
    const stage = e.target?.getStage();
    const pos = stage?.getPointerPosition();
    if (pos) {
      duplicateDragOffsetDoc.value = {
        x: (pos.x - duplicateDragStageStart.value.x) / props.scale,
        y: (pos.y - duplicateDragStageStart.value.y) / props.scale,
      };
    }
    return;
  }

  // 既存アノテーション上での曖昧開始が、実際のドラッグへ発展したかどうかを判定する。
  // 発展すれば（まだ選択編集へは切り替えず）その場から新規描画を開始する
  if (pendingOverAnnotStart.value) {
    const stage = e.target?.getStage();
    const pos = stage?.getPointerPosition();
    if (pos) {
      const pending = pendingOverAnnotStart.value;
      const dx = pos.x - pending.screenPos.x;
      const dy = pos.y - pending.screenPos.y;
      if (Math.hypot(dx, dy) > DUPLICATE_DRAG_THRESHOLD_PX) {
        pendingOverAnnotStart.value = null;
        if (drawingType.value in ANNOTATION_REGISTRY) {
          const module = ANNOTATION_REGISTRY[drawingType.value as AnnotationStyle['type']];
          if (module.geometry.drawMode === 'clickPoints') {
            clickPointsStartScreenPos.value = pending.screenPos;
            handleClickPointsMouseDown(pending.docPos, module.geometry);
          } else {
            isDrawing.value = true;
            startPos.value = pending.docPos;
            selectedAnnotIds.value = [];
            endDrawingAnnotation = startDrawingAnnotation(
              page.value,
              pending.docPos.x,
              pending.docPos.y,
              editorStore.currentAnnotationStyle,
            );
            updateDrawingPreview(pos.x / props.scale, pos.y / props.scale);
          }
        }
      }
    }
    return;
  }

  if (clickPointsBuffer.value) {
    const stage = e.target?.getStage();
    if (!stage) return;

    const pos = stage.getPointerPosition();
    if (!pos) return;

    updateClickPointsPreview({ x: pos.x / props.scale, y: pos.y / props.scale });
    return;
  }

  if (isDrawing.value && startPos.value) {
    const stage = e.target?.getStage();
    if (!stage) return;

    const pos = stage.getPointerPosition();
    if (!pos) return;

    const adjustedPos = {
      x: pos.x / props.scale,
      y: pos.y / props.scale,
    };

    updateDrawingPreview(adjustedPos.x, adjustedPos.y);
    return;
  }
  // カーソル制御
  const overAnnot = e.target !== e.target.getStage() && Boolean(e.target.attrs?.id);
  // アンカ（端点）上なら掴む系カーソルを表示
  const isAnchor = e.target !== e.target.getStage() && e.target.attrs?.name === 'annotation-anchor';
  if (drawingType.value === 'hand') {
    // ハンドモードは常に手のひらカーソル（パン操作可能であることを示す）
    cursor.value = 'grab';
  } else if (isAnchor) {
    cursor.value = 'grab';
  } else if (isDrawingTool.value) {
    // 描画モード中は既存アノテーション上にホバーしても選択モードのカーソルに変化させない
    // （クリックなら選択、ドラッグなら新規描画になることを示すため、常にcrosshairのまま）
    cursor.value = 'crosshair';
  } else {
    // ポインタ（選択）モード: 移動可能な注釈上にホバーしていれば移動用カーソルにする
    cursor.value = overAnnot ? 'move' : 'default';
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
  if (duplicateDragSource.value) {
    const source = duplicateDragSource.value;
    const offset = duplicateDragOffsetDoc.value;
    duplicateDragSource.value = null;
    duplicateDragStageStart.value = null;
    duplicateDragOffsetDoc.value = { x: 0, y: 0 };
    pendingPointerTarget.value = null;

    const duplicated = duplicateAnnotation(
      source,
      page.value,
      source.x + offset.x,
      source.y + offset.y,
    );
    void props.onRegisterAnnot(duplicated).then(() => {
      selectedAnnotIds.value = [duplicated.id];
    });
    return;
  }

  if (pendingOverAnnotStart.value) {
    // ドラッグへ発展しなかった単なるクリックだったため、既存アノテーションの選択編集として扱う
    // （描画モードのままだと選択・編集ができないため、ポインタモードへ切り替える）
    const { id } = pendingOverAnnotStart.value;
    pendingOverAnnotStart.value = null;
    editorStore.activeAnnotationType = undefined;
    editorStore.currentTools = 'pointer';
    selectedAnnotIds.value = [id];
    return;
  }

  if (ctrlDragCandidate.value) {
    // ドラッグへ発展しなかった単なるCtrl+クリックだったため、元々の意図通り選択解除する
    const { id } = ctrlDragCandidate.value;
    ctrlDragCandidate.value = null;
    selectedAnnotIds.value = selectedAnnotIds.value.filter((existingId) => existingId !== id);
    pendingPointerTarget.value = null;
    return;
  }

  // line/textのような2点で完成する種別を「押したままドラッグ→離す」で描いた場合、
  // 1点目を置いた直後のmouseupで2点目を確定する（クリックのみでの描画と共存させるための分岐）
  if (clickPointsBuffer.value?.length === 1 && clickPointsStartScreenPos.value) {
    const style = editorStore.currentAnnotationStyle;
    const geometry =
      style.type in ANNOTATION_GEOMETRY ? ANNOTATION_GEOMETRY[style.type] : undefined;
    if (geometry?.drawMode === 'clickPoints' && geometry.maxPoints === 2) {
      const stage = e.target?.getStage();
      const pos = stage?.getPointerPosition();
      if (pos) {
        const dragDistance = Math.hypot(
          pos.x - clickPointsStartScreenPos.value.x,
          pos.y - clickPointsStartScreenPos.value.y,
        );
        if (dragDistance > DUPLICATE_DRAG_THRESHOLD_PX) {
          handleClickPointsMouseDown({ x: pos.x / props.scale, y: pos.y / props.scale }, geometry);
        }
      }
    }
  }

  if (isDrawing.value && startPos.value) {
    const stage = e.target?.getStage();
    if (!stage) return;

    const pos = stage.getPointerPosition();
    if (!pos) return;

    const adjustedPos = {
      x: pos.x / props.scale,
      y: pos.y / props.scale,
    };

    isDrawing.value = false;
    drawingPreviewConfig.value = null;

    if (endDrawingAnnotation) {
      const annotation = endDrawingAnnotation(adjustedPos.x, adjustedPos.y);
      if (annotation) {
        const shouldStartTextEdit = ANNOTATION_REGISTRY[annotation.type].supportsInlineTextEdit;
        void props.onRegisterAnnot(annotation).then(() => {
          // 描き終えたら選択モードへ自動的に戻る（テキストは直後にインライン編集へ入るため対象外。
          // プリセットのダブルクリックでstickyDrawModeが有効な場合は戻さず連続して描き続けられるようにする）
          const switchedToPointer = returnToPointerModeUnlessSticky();
          if (shouldStartTextEdit && annotation.type === 'text') {
            startTextEdit(annotation);
          } else if (switchedToPointer) {
            selectedAnnotIds.value = [annotation.id];
          }
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
    // 交差選択の実形状判定用に、選択矩形をドキュメント座標系（scale未適用）へ変換しておく
    const docSelectionRect = {
      x: selectionRect.x / props.scale,
      y: selectionRect.y / props.scale,
      width: selectionRect.width / props.scale,
      height: selectionRect.height / props.scale,
    };

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

        // 交差選択（cross）: まずAABB同士の重なりで足切りし、次に実形状での交差判定を行う。
        // AABBだけでは折れ線・円のバウンディングボックス内の空白部分まで選択されてしまうため
        const aabbOverlaps = !(
          rect.x + rect.width < selectionRect.x ||
          rect.x > selectionRect.x + selectionRect.width ||
          rect.y + rect.height < selectionRect.y ||
          rect.y > selectionRect.y + selectionRect.height
        );
        if (!aabbOverlaps) return null;

        const annotation = props.annotations.find((a) => a.id === node.attrs.id);
        if (!annotation) return null;
        const intersects = ANNOTATION_GEOMETRY[annotation.type].intersectsRect(
          annotation,
          docSelectionRect,
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
