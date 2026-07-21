<template>
  <div class="document-layout row" @click="editorStore.selectTab(file, layoutSide, true)">
    <!-- 左Drawer：ドキュメント情報とサムネイル -->
    <DocumentLeftDrawer
      v-model:drawer-open="editorStore.leftDrawerModel"
      :total-page-count="pageCount"
      :current-page="currentPage"
      :thumnails="thumbnails"
      @go-to-page="goToPage"
      class="col-1"
    />

    <!-- メインコンテンツ領域 -->
    <div class="document-main-content col">
      <!-- タブコンテンツ：文書とアノテーション表示 -->
      <div ref="viewer" class="document-viewer-wrapper">
        <DocumentViewer
          v-if="!loading && onRender"
          :file="file"
          :page-count="pageCount"
          :page-sizes="pageSizes"
          :view-mode="viewMode"
          :annotations="annotations"
          @render="onRender"
          @zoom-in="zoomIn"
          @zoom-out="zoomOut"
          @scroll-to-current-page="scrollToCurrentPage"
          v-model:selected-annot-ids="selectedAnnotationIds"
          v-model:current-page="currentPage"
          v-model:zoom-level="zoomLevel"
        />
        <div v-else-if="loading" class="loading-state fit">
          <q-spinner color="primary" size="3em" />
          <p class="q-mt-md">{{ $t('pdfEditor.document.loading') }}</p>
        </div>
      </div>

      <!-- フッター：ページネーション、ズーム等 -->
      <DocumentFooter
        v-model:current-page="currentPage"
        v-model:view-mode="viewMode"
        v-model:zoom-level="zoomLevel"
        :total-page-count="pageCount"
        :scale="zoomLevel"
        @go-to-first-page="goToFirstPage"
        @previous-page="previousPage"
        @next-page="nextPage"
        @go-to-last-page="goToLastPage"
        @go-to-page="goToPage"
        @set-zoom="setZoomLevel"
        @zoom-in="zoomIn"
        @zoom-out="zoomOut"
      />
    </div>

    <!-- 右Drawer：アノテーションプロパティ -->
    <DocumentRightDrawer
      :key="JSON.stringify(selectedAnnotations)"
      :selected-annots="selectedAnnotations"
      :file="prop.file"
      :on-delete-selected="annotationActions.deleteSelected"
      v-model:drawer-open="editorStore.rightDrawerModel"
      @add-relation="startRelationalFromDrawer"
      class="col-1"
    />

    <!-- 関係性の簡易閲覧ダイアログ（Spaceキーで表示） -->
    <RelationalPeekDialog
      v-if="peekAnnotId"
      v-model:open="peekDialogOpen"
      :annot-id="peekAnnotId"
    />
  </div>
</template>

<script setup lang="ts">
import DocumentLeftDrawer from 'src/components/DocLayout/DocumentLeftDrawer.vue';
import DocumentViewer from 'src/components/DocLayout/DocumentViewer.vue';
import DocumentRightDrawer from 'src/components/DocLayout/DocumentRightDrawer.vue';
import DocumentFooter from 'src/components/DocLayout/DocumentFooter.vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useBackendApi } from 'src/apis/backendApi';
import {
  acquirePdf,
  generateThumbnail,
  getPageViewportSizes,
  renderPage,
  type AcquiredPdfDocument,
  type PageSize,
} from '../Viewer/pdfManager';
import type { ViewMode } from 'src/models/docPage';
import { useEditorStore } from 'src/stores/editorStore';
import type { LayoutSide } from 'src/stores/editorStore';
import { useHistoryStore } from 'src/stores/historyStore';
import { useRelationalStore } from 'src/stores/relationalStore';
import { callEditorTools } from 'src/stores/editorTools';
import type { ContainerElementFile } from 'src/models/container';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import { buildRelationalRule } from 'src/models/relational/ruleUtils';
import RelationalPeekDialog from 'src/components/DocLayout/RelationalPeekDialog.vue';
import { useQuasar } from 'quasar';
import { saveDocument } from 'src/utils/document/saveDocument';
import { confirmDialog } from 'src/components/Dialog/confirmDialog';
import { useAnnotationActions } from './composables/useAnnotationActions';

interface Prop {
  file: ContainerElementFile;
  layoutSide: LayoutSide;
}
const prop = defineProps<Prop>();
const viewer = useTemplateRef('viewer');
const api = useBackendApi();

const $q = useQuasar();
const { t } = useI18n();
const editorStore = useEditorStore();
const historyStore = useHistoryStore();
const relationalStore = useRelationalStore();

// TODO: PDFの読み込みに失敗した場合、Loading画面を抜けてエラーが起きた旨を通知する仕様に修正
const loading = ref<boolean>(true);

// for drawers
const thumbnails = ref<string[]>([]);

// for document
type RenderFunc = (
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number,
) => Promise<PageSize>;
const onRender = ref<RenderFunc>();
const currentPage = ref(1);
const pageCount = ref(0);
const pageSizes = ref<PageSize[]>([]);
// acquirePdfで取得したPDFの解放ハンドル。onBeforeUnmountで必ずreleaseする
let acquiredPdf: AcquiredPdfDocument | undefined;
// acquirePdfの完了を待つ間にタブが閉じられたかどうかを記録する
let isUnmounted = false;
let stopAnnotationObservation: (() => void) | undefined;

// for annotations
const annotations = ref<AnnotationStyle[]>([]);
const selectedAnnotationIds = ref<AnnotationID[]>([]);
const selectedAnnotations = computed(() =>
  selectedAnnotationIds.value
    .map((aId) => annotations.value.find((annot) => annot.id === aId))
    .filter((annot) => annot !== void 0),
);
// アノテーションに対するショートカット操作（削除・微調整・コピー・貼り付け・複製・重ね順変更）をまとめる。
// キーボードハンドラにロジックを直書きせず、将来の右クリックコンテキストメニューからも
// 同じ関数を呼べるようにするための共有アクション層
const annotationActions = useAnnotationActions({
  file: prop.file,
  annotations,
  selectedAnnotationIds,
  currentPage,
});

// バックエンド側のアノテーション情報の更新を反映する
const observed = api.observedAnnotationStylesByFile(prop.file);
if (observed.ok) {
  const subscription = observed.data.subscribe((value) => {
    annotations.value = value;
    selectedAnnotationIds.value = selectedAnnotationIds.value.filter((aId) =>
      value.some((annot) => annot.id === aId),
    );
  });
  stopAnnotationObservation = () => subscription.unsubscribe();
}

// for footer
const zoomLevel = ref(100);
const viewMode = ref<ViewMode>('single');

// for relational peek dialog
const peekAnnotId = ref<AnnotationID>();
const peekDialogOpen = ref(false);

// ================================

/**
 * 実ファイルの内容が`.rdcfg`記録時から変更されている場合の解決を試みる
 *
 * ユーザーに確認の上、可能であればアノテーション位置を新しい内容に追跡し直して確定する
 * （既存のExpContainer.vueの外部変更コンフリクトと同様、ユーザーの明示的な操作なしには確定しない）。
 * 追跡できなかった場合も実ファイル自体は開けるようにし、警告のみ表示する
 *
 * @returns 文書を開いてよい場合はtrue、ユーザーがキャンセルした場合はfalse
 */
async function resolveConfigConflict(): Promise<boolean> {
  const proceed = await confirmDialog({
    title: t('pdfEditor.document.conflictTitle'),
    message: t('pdfEditor.document.conflictMessage'),
    severity: 'negative',
  });
  if (!proceed) return false;

  const updatedConfig = await api.updateDocumentConfig(prop.file);
  if (updatedConfig.ok) {
    const acceptRes = await api.acceptExternalDocumentConfig(prop.file, updatedConfig.data);
    if (acceptRes.ok) return true;
  }

  $q.notify({ type: 'warning', message: t('pdfEditor.document.conflictTrackFailed') });
  return true;
}

async function loadDocument() {
  loading.value = true;

  // 実ファイルの`.rdcfg`を確認し、キャッシュ（アノテーションDB）を最新の内容と整合させる。
  // ハッシュ不一致（外部での更新）を検知した場合はコンフリクト解決を経てから開く
  // （それ以外の読み込み失敗は後続のgetDocumentSourceでも同様に検知されるため、ここでは無視して進める）
  const configRes = await api.loadDocumentConfig(prop.file);
  if (!configRes.ok && configRes.error.key === 'DOC_CONFIG_CONFLICT') {
    const shouldContinue = await resolveConfigConflict();
    if (!shouldContinue) {
      loading.value = false;
      editorStore.closeTab(prop.file, prop.layoutSide);
      return;
    }
  }

  const docSrc = await api.getDocumentSource(prop.file);
  if (!docSrc.ok) {
    loading.value = false;
    return;
  }

  // PDFファイルを読み込む（ファイル単位でキャッシュされたPDFDocumentProxyを取得する。
  // 使い終わったら`onBeforeUnmount`で必ず`release`すること）
  const acquired = await acquirePdf(prop.file, docSrc.data);
  // 取得待機中にタブが閉じられた場合は、参照を返却して以降の状態更新を行わない
  if (isUnmounted) {
    acquired.release();
    return;
  }
  acquiredPdf = acquired;
  const loadedDocument = acquired.document;
  pageCount.value = loadedDocument.numPages;

  // 連続表示モードでの仮想化（画面近傍のみ実描画）用に、全ページのレイアウトサイズを先に取得しておく
  pageSizes.value = await getPageViewportSizes(loadedDocument);

  // レンダリング関数を設定
  onRender.value = async (
    pageNumber: number,
    canvas: HTMLCanvasElement,
    scale: number,
  ): Promise<PageSize> => {
    return await renderPage(loadedDocument, pageNumber, canvas, scale);
  };

  // サムネイルを生成
  thumbnails.value = await Promise.all(
    Array.from({ length: pageCount.value }, (_, idx) =>
      generateThumbnail(loadedDocument, idx + 1, 120),
    ),
  );

  loading.value = false;
}

// ================================

/**
 * ズームレベルを設定
 */
const setZoomLevel = (level: number): void => {
  const MIN_ZOOM = 20;
  const MAX_ZOOM = 800;
  zoomLevel.value = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, level));
};

/**
 * ズームイン
 */
const zoomIn = (step: number = 5): void => {
  setZoomLevel(zoomLevel.value + step);
};

/**
 * ズームアウト
 */
const zoomOut = (step: number = 5): void => {
  setZoomLevel(zoomLevel.value - step);
};

// ================================

/**
 * 最初のページへ移動
 */
const goToFirstPage = (): void => {
  currentPage.value = 1;
};

/**
 * 前のページへ移動
 */
const previousPage = (): void => {
  currentPage.value = Math.max(1, currentPage.value - 1);
};

/**
 * 指定したページへ移動
 */
const goToPage = (page: number): void => {
  currentPage.value = Math.max(1, Math.min(pageCount.value, Math.floor(page)));
};

/**
 * 次のページへ移動
 */
const nextPage = (): void => {
  currentPage.value = Math.min(pageCount.value, currentPage.value + 1);
};

/**
 * 最後のページへ移動
 */
const goToLastPage = (): void => {
  currentPage.value = pageCount.value;
};

// ================================

/**
 * 連続表示モード時に現在ページをビューにスクロール
 */
async function scrollToCurrentPage(viewerContainerHeight: number) {
  if (viewMode.value !== 'continuousSingle') return;

  await nextTick();

  if (viewer.value) {
    viewer.value.scrollTo({
      top: viewerContainerHeight * ((currentPage.value - 1) / pageCount.value),
    });
  }
}

// ================================

/**
 * 関係性登録の待機中に表示する通知（q.Notify）のハンドル
 *
 * 呼び出すと通知内容を更新でき、引数なしで呼び出すと通知を閉じられる
 * cf) https://quasar.dev/quasar-plugins/notify#updating-a-notification
 */
let relationalNotifyHandle: ((props?: Record<string, unknown>) => void) | undefined;

/**
 * 待機中の関係性モードに応じた通知メッセージを組み立てる
 */
function relationalWaitingMessage(): string {
  const modeLabel =
    editorStore.relationalMode === 'equal'
      ? t('pdfEditor.tools.relational.equal')
      : t('pdfEditor.tools.relational.link');
  return t('pdfEditor.tools.relational.waitingMessage', { mode: modeLabel });
}

/**
 * 対になるアノテーションの待機通知を表示・更新する
 * モード変更ボタンから再度呼び出すことで通知内容を最新化する
 */
function showRelationalWaitingNotify() {
  const notifyProps = {
    message: relationalWaitingMessage(),
    color: 'primary',
    position: 'bottom-right' as const,
    timeout: 0,
    actions: [
      {
        label: t('pdfEditor.tools.relational.equal'),
        noDismiss: true,
        handler: () => {
          editorStore.relationalMode = 'equal';
          showRelationalWaitingNotify();
        },
      },
      {
        label: t('pdfEditor.tools.relational.link'),
        noDismiss: true,
        handler: () => {
          editorStore.relationalMode = 'link';
          showRelationalWaitingNotify();
        },
      },
      {
        label: t('pdfEditor.tools.relational.cancel'),
        handler: () => {
          editorStore.cancelRelationalPending();
        },
      },
    ],
  };

  if (relationalNotifyHandle) {
    relationalNotifyHandle(notifyProps);
  } else {
    relationalNotifyHandle = $q.notify(notifyProps);
  }
}

/**
 * 待機中の基準アノテーションと対象アノテーションの間に関係性を登録する
 */
async function finishRelational(targetId: AnnotationID) {
  const srcId = editorStore.relationalPendingId;
  const mode = editorStore.relationalMode;
  const pendingFile = editorStore.relationalPendingFile;
  if (srcId === undefined || mode === undefined) return;
  if (srcId === targetId) return; // 自分自身との関係性は無視

  // 通知や待機状態は結果を待たずに解除し、モード自体は次の登録に備えて維持する
  editorStore.cancelRelationalPending();

  const res = await api.registRelationals({
    srcID: srcId,
    targetID: targetId,
    rule: buildRelationalRule(mode),
  });
  if (!res.ok) {
    $q.notify({ type: 'negative', message: t('pdfEditor.tools.relational.registerFailed') });
    return;
  }
  $q.notify({ type: 'positive', message: t('pdfEditor.tools.relational.registerSuccess') });

  // 新規登録した関係性を検証状態キャッシュに反映する（基準アノテーションが別タブのファイルの場合はそちらも）
  void relationalStore.refreshFile(prop.file);
  if (pendingFile !== undefined && !isSameFile(pendingFile, prop.file)) {
    void relationalStore.refreshFile(pendingFile);
  }

  scheduleAutoSave();
}

/**
 * RightDrawerの「リンクを追加」ボタンから関係性登録の待機を開始する
 */
function startRelationalFromDrawer(annotId: AnnotationID) {
  editorStore.relationalMode ??= 'link';
  editorStore.startRelationalPending(annotId, prop.file);
  showRelationalWaitingNotify();
}

/**
 * 2つのファイルがcontainerID込みで同一かどうか
 */
function isSameFile(a: ContainerElementFile, b: ContainerElementFile): boolean {
  return a.containerID === b.containerID && a.path === b.path;
}

/**
 * 現在のファイルが、待機中の基準アノテーションが属するファイルと同一かどうか
 */
function isRelationalPendingFile(): boolean {
  const pendingFile = editorStore.relationalPendingFile;
  return pendingFile !== undefined && isSameFile(pendingFile, prop.file);
}

/**
 * アノテーションの追加を検知し、関係性登録の待機開始・確定を制御する
 * 1つ目の追加で待機モードへ、待機中の2つ目の追加で関係性を確定する
 */
async function registRelationalByAdd(newAnnots: AnnotationStyle[], oldAnnots: AnnotationStyle[]) {
  if (editorStore.relationalMode === void 0) return;
  const oldAnnotIds = new Set(oldAnnots.map((annot) => annot.id));
  const addedAnnots = newAnnots.filter((annot) => !oldAnnotIds.has(annot.id));
  if (addedAnnots.length !== 1) return; // アノテーションが1つ増えたときのみ対象
  const addedId = addedAnnots[0]?.id;
  if (addedId === undefined) return;

  if (editorStore.relationalPendingId === undefined) {
    // 1つ目のアノテーション：対になるアノテーションの待機モードへ移行
    editorStore.startRelationalPending(addedId, prop.file);
    showRelationalWaitingNotify();
    return;
  }

  // 2つ目のアノテーション：待機中の関係性を確定
  await finishRelational(addedId);
}

/**
 * アノテーションの選択を検知し、待機中の関係性を確定する
 */
async function registRelationalBySelect(selectedIds: AnnotationID[]) {
  if (editorStore.relationalMode === void 0) return;
  if (editorStore.relationalPendingId === undefined) return;
  const targetId = selectedIds.find((id) => id !== editorStore.relationalPendingId);
  if (targetId === undefined) return;

  await finishRelational(targetId);
}

/**
 * アノテーション一覧の変化に応じて、待機解除・待機開始・関係性確定を判断する
 */
async function handleAnnotationsChanged(
  newAnnots: AnnotationStyle[],
  oldAnnots: AnnotationStyle[],
) {
  // 待機中の基準アノテーションが（このファイル内で）削除された場合は待機を解除する
  if (
    editorStore.relationalPendingId !== undefined &&
    isRelationalPendingFile() &&
    !newAnnots.some((annot) => annot.id === editorStore.relationalPendingId)
  ) {
    editorStore.cancelRelationalPending();
    return;
  }

  await registRelationalByAdd(newAnnots, oldAnnots);

  // アノテーション内容（OCR結果）の読み込み完了時にもこのイベントが発火するため、
  // ここで再検証しておくことで「検証保留」から自動的にOK/NGへ遷移する
  void relationalStore.refreshFile(prop.file);

  scheduleAutoSave();
}

// ================================

/** 自動保存のデバウンス時間（ミリ秒）。編集操作のたびに保存すると重いため、少し待ってからまとめて保存する */
const AUTO_SAVE_DEBOUNCE_MS = 1500;
let autoSaveTimer: ReturnType<typeof setTimeout> | undefined;
let hasPendingAutoSave = false;

/**
 * 「自動保存」がオンの場合、一定時間後にこの文書を保存する（連続編集中は都度リセットする）
 */
function scheduleAutoSave() {
  if (!editorStore.autoSaveAnnotations) return;

  hasPendingAutoSave = true;
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    hasPendingAutoSave = false;
    void saveDocument(prop.file);
  }, AUTO_SAVE_DEBOUNCE_MS);
}

// ================================

/** 矢印キー1回あたりの微調整量（px、文書座標） */
const NUDGE_STEP = 1;

/**
 * アノテーション編集のキーボードショートカットをまとめて処理する
 *
 * Spaceキー（関係性の簡易閲覧）に加え、削除（Delete/Backspace）・微調整（矢印キー）・
 * コピー（Ctrl+C）・貼り付け（Ctrl+V）・元に戻す（Ctrl+Z）・やり直す（Ctrl+Y／Ctrl+Shift+Z）を扱う。
 * 実際の処理はすべて`useAnnotationActions`／`historyStore`に委譲し、ここでは対象の絞り込み
 * （選択の有無）とイベントの振り分けのみを行う。
 * テキスト入力中は無視し、複数ペイン表示時はフォーカスされているペイン（layoutSide）でのみ反応する。
 * このコンポーネントは常にアクティブなタブに対して1つだけマウントされるため、historyStoreへの
 * 操作対象は常に`prop.file`（＝現在このペインでアクティブなタブ）となり、他タブへの誤操作は起きない
 */
function handleGlobalKeydown(e: KeyboardEvent) {
  if (editorStore.activeSide !== prop.layoutSide) return;

  const activeEl = document.activeElement;
  const isTextInput =
    activeEl instanceof HTMLElement &&
    (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);
  if (isTextInput) return;

  if (e.code === 'Space') {
    if (selectedAnnotationIds.value.length !== 1) return;
    e.preventDefault();
    peekAnnotId.value = selectedAnnotationIds.value[0];
    peekDialogOpen.value = true;
    return;
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedAnnotationIds.value.length === 0) return;
    e.preventDefault();
    void annotationActions.deleteSelected();
    return;
  }

  if (
    e.key === 'ArrowUp' ||
    e.key === 'ArrowDown' ||
    e.key === 'ArrowLeft' ||
    e.key === 'ArrowRight'
  ) {
    if (selectedAnnotationIds.value.length === 0) return;
    e.preventDefault();
    const dx = e.key === 'ArrowLeft' ? -NUDGE_STEP : e.key === 'ArrowRight' ? NUDGE_STEP : 0;
    const dy = e.key === 'ArrowUp' ? -NUDGE_STEP : e.key === 'ArrowDown' ? NUDGE_STEP : 0;
    void annotationActions.nudgeSelected(dx, dy);
    return;
  }

  const isModifierPressed = e.ctrlKey || e.metaKey;

  if (isModifierPressed && e.key.toLowerCase() === 'c') {
    if (selectedAnnotationIds.value.length === 0) return;
    e.preventDefault();
    annotationActions.copySelected();
    return;
  }

  if (isModifierPressed && e.key.toLowerCase() === 'v') {
    e.preventDefault();
    void annotationActions.pasteClipboard();
    return;
  }

  if (isModifierPressed && !e.shiftKey && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    void historyStore.undo(prop.file);
    return;
  }

  if (
    (isModifierPressed && e.shiftKey && e.key.toLowerCase() === 'z') ||
    (isModifierPressed && e.key.toLowerCase() === 'y')
  ) {
    e.preventDefault();
    void historyStore.redo(prop.file);
    return;
  }
}

// ================================

onMounted(async () => {
  editorStore.setMainTools(await callEditorTools(t));
  await loadDocument();
  void relationalStore.refreshFile(prop.file);
  window.addEventListener('keydown', handleGlobalKeydown);
});

watch(annotations, (newAnnots, oldAnnots) => {
  void handleAnnotationsChanged(newAnnots, oldAnnots);
});
watch(selectedAnnotationIds, (selectedIds) => {
  void registRelationalBySelect(selectedIds);
});
// アクティブなペインの選択状態を、スタイルパネル（MainTools/SubTools行）用にeditorStoreへ橋渡しする。
// 選択状態自体はペインごとのこのコンポーネントが持つため、layerOrderAction等と同じ
// 「意図・状態をeditorStoreに反映する」パターンを踏襲する
watch(
  [selectedAnnotations, () => editorStore.activeSide],
  () => {
    if (editorStore.activeSide === prop.layoutSide) {
      editorStore.setActiveSelection(prop.file, selectedAnnotations.value);
    } else if (
      editorStore.activeSelection !== undefined &&
      isSameFile(editorStore.activeSelection.file, prop.file)
    ) {
      editorStore.clearActiveSelection();
    }
  },
  { immediate: true },
);
// 重ね順ツールバー（MainTools/SubTools）からの意図をここで実行する。
// ツール自体は選択状態を持たないため、選択状態を持つこの場所でwatchして実処理を行う
watch(
  () => editorStore.layerOrderAction,
  (action) => {
    if (action === undefined) return;
    if (editorStore.activeSide !== prop.layoutSide) return;
    void annotationActions.reorderSelected(action).finally(() => {
      editorStore.clearLayerOrderAction();
    });
  },
);
// 待機状態がストア側から解除された場合（キャンセル操作やモードオフなど）に通知を閉じる
watch(
  () => editorStore.relationalPendingId,
  (pendingId) => {
    if (pendingId === undefined) {
      relationalNotifyHandle?.();
      relationalNotifyHandle = undefined;
    }
  },
);
onBeforeUnmount(() => {
  // 非同期のPDF取得完了後にも参照を返却できるよう、先に破棄状態を記録する
  isUnmounted = true;

  // 自動保存の待機中にタブが閉じられた場合、変更を失わないよう即座に保存する
  // （ただし削除によるクローズの場合、実ファイルは既に無いため保存を試みない）
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    const isDeleting = editorStore.isPendingDeletion(prop.file.containerID, prop.file.path);
    if (hasPendingAutoSave && !isDeleting) void saveDocument(prop.file);
  }

  stopAnnotationObservation?.();
  window.removeEventListener('keydown', handleGlobalKeydown);

  // 読み込んだPDFDocumentProxyの参照を返却する（他のタブ・OCR処理から参照されていなければ
  // 猶予期間後に破棄される。acquireに至らなかった場合は何もしない）
  acquiredPdf?.release();

  // このペインの選択がスタイルパネルに反映されたままタブが閉じられた場合、選択状態を解除する
  if (
    editorStore.activeSelection !== undefined &&
    isSameFile(editorStore.activeSelection.file, prop.file)
  ) {
    editorStore.clearActiveSelection();
  }
});
</script>

<style scoped lang="scss">
@use 'sass:color';

.document-layout {
  height: 100%;
  width: 100%;
  background: white;
  overflow: hidden;
}

.body--dark .document-layout {
  background: $dark;
}

.document-main-content {
  display: flex;
  flex-direction: column;
  background: $grey-1;
  height: 100%;
  width: 100%;
}

.body--dark .document-main-content {
  background: color.adjust($dark, $lightness: -5%);
}

.document-viewer-wrapper {
  flex: 1 1 0;
  overflow: auto;
  background: $grey-1;
  width: 100%;
}

.body--dark .document-viewer-wrapper {
  background: color.adjust($dark, $lightness: -5%);
}

.loading-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: $grey-1;
}

.body--dark .loading-state {
  background: color.adjust($dark, $lightness: -5%);
}
</style>
