<template>
  <div
    class="document-layout row"
    @click="editorStore.selectTab(file, layoutSide, true)"
    @contextmenu="editorStore.selectTab(file, layoutSide, true)"
  >
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
      <div
        ref="viewer"
        class="document-viewer-wrapper"
        :class="{ 'is-panning': isPanning }"
        @mousedown="onViewerMouseDown"
      >
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

    <!-- 関係性の簡易閲覧ダイアログ（Spaceキーで表示） -->
    <RelationalPeekDialog
      v-if="peekAnnotId"
      v-model:open="peekDialogOpen"
      :annot-id="peekAnnotId"
      :file="prop.file"
    />
  </div>
</template>

<script setup lang="ts">
import DocumentLeftDrawer from 'src/components/DocLayout/DocumentLeftDrawer.vue';
import DocumentViewer from 'src/components/DocLayout/DocumentViewer.vue';
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
import type { ContainerElementFile, ContainerID } from 'src/models/container';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import { buildRelationalRule } from 'src/models/relational/ruleUtils';
import RelationalPeekDialog from 'src/components/DocLayout/RelationalPeekDialog.vue';
import {
  RELATIONAL_STATUS_MESSAGE_KEY,
  startRelationalDefine,
} from 'src/components/DocLayout/composables/useRelationalDefine';
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

// ハンドモード時のドラッグパン。Konva/AnnotationLayer側はhandモードで一切介入しないため、
// 実際にスクロールする`.document-viewer-wrapper`（このrefが指す要素）へ直接ネイティブの
// マウスイベントで実装する
const isPanning = ref(false);
// ドラッグパン中の`window`リスナー解除関数。ドラッグ完了時だけでなく、
// ドラッグ中にタブごとアンマウントされた場合にも解除できるよう、コンポーネントスコープで保持する
let stopViewerPanning: (() => void) | undefined;

/** ハンドモード時、ビューワーのドラッグパン操作を開始する */
function onViewerMouseDown(e: MouseEvent) {
  if (editorStore.currentTools !== 'hand') return;
  if (!viewer.value) return;
  // クロージャ内でnull許容を再考させないよう、非null確定済みの別バインディングに移す
  const target: HTMLElement = viewer.value;

  isPanning.value = true;
  const startX = e.clientX;
  const startY = e.clientY;
  const startScrollLeft = target.scrollLeft;
  const startScrollTop = target.scrollTop;

  function onWindowMouseMove(moveEvent: MouseEvent) {
    target.scrollLeft = startScrollLeft - (moveEvent.clientX - startX);
    target.scrollTop = startScrollTop - (moveEvent.clientY - startY);
  }
  function onWindowMouseUp() {
    isPanning.value = false;
    stopViewerPanning = undefined;
    window.removeEventListener('mousemove', onWindowMouseMove);
    window.removeEventListener('mouseup', onWindowMouseUp);
  }
  window.addEventListener('mousemove', onWindowMouseMove);
  window.addEventListener('mouseup', onWindowMouseUp);
  stopViewerPanning = onWindowMouseUp;
}

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

// このタブ（このファイル）宛てのページ遷移要求（`editorStore.openTab(file, targetPage)`）を、
// コンポーネント生成時点（初回描画より前）で同期的に取り出しておく。onMounted以降に
// currentPageを書き換えると、PdfPage側が既に1ページ目で描画を始めた直後に2回目の描画が
// 割り込むことになり、同一canvasへの並行描画により表示が崩れる（上下反転して見える等）
// 不具合につながる。currentPageの初期値自体に反映しておけば、PdfPageは最初から目的の
// ページで1回だけ描画される
const initialTabFocus = (() => {
  const pending = editorStore.pendingTabFocus;
  if (pending === undefined || !isSameFile(pending, prop.file)) return undefined;
  editorStore.clearPendingTabFocus();
  return pending;
})();

const currentPage = ref(initialTabFocus?.page ?? 1);
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
 * 実ファイルの内容が`.kcfg`記録時から変更されている場合の解決を試みる
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

  // 実ファイルの`.kcfg`を確認し、キャッシュ（アノテーションDB）を最新の内容と整合させる。
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
  // 連続定義モードが、選択され続けているだけのこの対象を新たな起点と誤認しないための目印
  editorStore.relationalLastPairedId = targetId;

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

  // 連続定義モード（関係性ボタンのダブルクリックで開始）が有効な場合でも、ここでは基準を
  // リセットするだけに留める。次に選択されたアノテーションを新たな基準とする処理は
  // `RelationalDefineButtons.vue`側で選択変化を監視して行う（1組確定するごとに直前の対象と
  // 自動で連鎖させるのではなく、次の選択を独立した新しいペアの起点として扱うため）

  scheduleAutoSave();
}

/**
 * 2つのファイルがcontainerID込みで同一かどうか
 *
 * `a`はcontainerID・pathさえ持っていれば`ContainerElementFile`そのものでなくてもよい
 * （`editorStore.pendingTabFocus`のような最小限のフィールドしか持たない値とも比較できるようにする）
 */
function isSameFile(
  a: { containerID: ContainerID; path: string },
  b: ContainerElementFile,
): boolean {
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
  const mode = editorStore.relationalMode;
  if (mode === undefined) return;
  const oldAnnotIds = new Set(oldAnnots.map((annot) => annot.id));
  const addedAnnots = newAnnots.filter((annot) => !oldAnnotIds.has(annot.id));
  if (addedAnnots.length !== 1) return; // アノテーションが1つ増えたときのみ対象
  const addedId = addedAnnots[0]?.id;
  if (addedId === undefined) return;

  if (editorStore.relationalPendingId === undefined) {
    // 1つ目のアノテーション：対になるアノテーションの待機モードへ移行
    startRelationalDefine(editorStore, t, mode, addedId, prop.file);
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
    if (historyStore.isBusy(prop.file)) return;
    void historyStore.undo(prop.file);
    return;
  }

  if (
    (isModifierPressed && e.shiftKey && e.key.toLowerCase() === 'z') ||
    (isModifierPressed && e.key.toLowerCase() === 'y')
  ) {
    e.preventDefault();
    if (historyStore.isBusy(prop.file)) return;
    void historyStore.redo(prop.file);
    return;
  }

  if (isModifierPressed && e.key.toLowerCase() === 's') {
    e.preventDefault();
    void saveDocument(prop.file);
  }
}

// ================================

onMounted(async () => {
  // メインツールの注入・撤去はアクティブタブの種別に応じてEditorPage.vueが一元管理する
  await loadDocument();
  void relationalStore.refreshFile(prop.file);
  window.addEventListener('keydown', handleGlobalKeydown);

  if (initialTabFocus !== undefined) {
    // ページ番号自体は既にcurrentPageの初期値へ反映済み。ここではpageCount確定後の
    // クランプ（同じ値であれば再代入しても再描画は発生しない）とアノテーション選択・
    // スクロールのみを行う
    goToPage(initialTabFocus.page);
    if (initialTabFocus.annotId !== undefined) {
      selectedAnnotationIds.value = [initialTabFocus.annotId];
    }
    await scrollToCurrentPage(viewer.value?.getBoundingClientRect().height ?? 0);
  }
});

/**
 * `editorStore.openTab(file, targetPage)`で指定されたページ遷移情報がこのファイル宛てであれば
 * 消費し、該当ページ・アノテーションへ遷移する
 *
 * このタブが既に開かれた状態（再マウントが起きないケース）専用の経路。PdfPageは既にマウント
 * 済みで`currentPage`の監視も有効なため、そのまま`goToPage`するだけで安全に1回だけ再描画される
 * （初回マウント時のページ遷移は`initialTabFocus`側で扱うため、ここでは処理しない）
 */
async function consumePendingTabFocus() {
  const pending = editorStore.pendingTabFocus;
  if (pending === undefined || !isSameFile(pending, prop.file)) return;

  editorStore.clearPendingTabFocus();
  goToPage(pending.page);
  if (pending.annotId !== undefined) selectedAnnotationIds.value = [pending.annotId];
  await scrollToCurrentPage(viewer.value?.getBoundingClientRect().height ?? 0);
}

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
// アノテーション右クリックメニューの「削除」からの意図をここで実行する（確認ダイアログなし）。
// メニュー自体は選択状態を持たないため、選択状態を持つこの場所でwatchして実処理を行う
watch(
  () => editorStore.deleteRequested,
  (requested) => {
    if (!requested) return;
    if (editorStore.activeSide !== prop.layoutSide) return;
    void annotationActions.deleteSelected().finally(() => {
      editorStore.clearDeleteRequest();
    });
  },
);
// アノテーション右クリックメニューの「関係性ダイアログを開く」からの意図をここで実行する。
// メニュー自体は選択状態を持たないため、選択状態を持つこの場所でwatchして実処理を行う
watch(
  () => editorStore.peekRequestedAnnotId,
  (annotId) => {
    if (annotId === undefined) return;
    if (editorStore.activeSide !== prop.layoutSide) return;
    if (!annotations.value.some((a) => a.id === annotId)) return; // 他ペインの誤反応防止
    peekAnnotId.value = annotId;
    peekDialogOpen.value = true;
    editorStore.clearPeekRequest();
  },
);
// 関係性ダイアログの「文書を開く」等、既にこのファイルが開かれている状態で新たに
// ページ遷移が要求された場合（タブの再マウントが起きないケース）をここで処理する。
// 初回ロード中はonMounted側の処理に任せる
watch(
  () => editorStore.pendingTabFocus,
  () => {
    if (loading.value) return;
    void consumePendingTabFocus();
  },
);
// アクティブなペインの表示モードを、メインツール（表示モードメニュー）用にeditorStoreへ橋渡しする
watch(
  [viewMode, () => editorStore.activeSide],
  () => {
    if (editorStore.activeSide === prop.layoutSide) {
      editorStore.setActiveViewMode(viewMode.value);
    }
  },
  { immediate: true },
);
// メインツール（表示モードメニュー）からの意図をここで実行する
watch(
  () => editorStore.viewModeAction,
  (mode) => {
    if (mode === undefined) return;
    if (editorStore.activeSide !== prop.layoutSide) return;
    viewMode.value = mode;
    editorStore.clearViewModeAction();
  },
);
// 待機状態がストア側から解除された場合（キャンセル操作やモードオフなど）にステータスメッセージを取り下げる
watch(
  () => editorStore.relationalPendingId,
  (pendingId) => {
    if (pendingId === undefined) {
      editorStore.clearStatusMessage(RELATIONAL_STATUS_MESSAGE_KEY);
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
  stopViewerPanning?.();

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

  &.is-panning {
    cursor: grabbing;
  }
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
