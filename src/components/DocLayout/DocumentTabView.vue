<template>
  <div
    class="document-layout"
    @click="editorStore.selectTab(file, layoutSide, true)"
    @contextmenu="editorStore.selectTab(file, layoutSide, true)"
  >
    <!-- メインコンテンツ領域 -->
    <div class="document-main-content">
      <!-- タブコンテンツ：文書とアノテーション表示 -->
      <div
        ref="viewer"
        class="document-viewer-wrapper"
        :class="{ 'is-panning': isPanning }"
        @mousedown="onViewerMouseDown"
      >
        <DocumentViewer
          v-if="!loading && onRender && onRenderTile && onGenerateThumbnail && onGetPageTextBlocks"
          ref="documentViewer"
          :file="file"
          :page-count="pageCount"
          :page-sizes="pageSizes"
          :view-mode="viewMode"
          :annotations="annotations"
          :search-matches="searchMatches"
          :active-search-match-id="activeSearchMatchId"
          @render="onRender"
          @render-tile="onRenderTile"
          @generate-thumbnail="onGenerateThumbnail"
          @get-page-text-blocks="onGetPageTextBlocks"
          @select-page="onSelectPageFromList"
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

      <!-- Ctrl+F 文書内検索バー（issue #33）。`.document-viewer-wrapper`のスクロールに巻き込まれず
           常に同じ位置に留まるよう、スクロールしない`.document-main-content`側に置く -->
      <SearchBar
        v-if="searchOpen"
        v-model:query="searchQuery"
        v-model:options="searchOptions"
        :match-count="searchMatchCount"
        :active-index="searchActiveIndex"
        :is-searching="searchIsSearching"
        :container-i-d="prop.file.containerID"
        @next="searchGoToNext"
        @previous="searchGoToPrevious"
        @close="closeSearch"
      />

      <!-- フッター：ページネーション、ズーム等 -->
      <DocumentFooter
        v-model:current-page="currentPage"
        v-model:zoom-level="zoomLevel"
        :total-page-count="pageCount"
        :scale="zoomLevel"
        :max-zoom="zoomMax"
        @go-to-first-page="goToFirstPage"
        @previous-page="previousPage"
        @next-page="nextPage"
        @go-to-last-page="goToLastPage"
        @go-to-page="goToPage"
        @set-zoom="setZoomLevel"
        @zoom-in="zoomIn"
        @zoom-out="zoomOut"
        @fit-width="fitToWidth"
        @fit-page="fitToPage"
      />
    </div>

    <!-- 関係性の簡易閲覧ダイアログ（Spaceキーで表示） -->
    <RelationalPeekDialog
      v-if="peekTarget"
      v-model:open="peekDialogOpen"
      :target="peekTarget"
      :file="prop.file"
    />
  </div>
</template>

<script setup lang="ts">
import DocumentViewer from 'src/components/DocLayout/DocumentViewer.vue';
import DocumentFooter from 'src/components/DocLayout/DocumentFooter.vue';
import SearchBar from 'src/components/DocLayout/SearchBar.vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useBackendApi } from 'src/apis/backendApi';
import {
  acquirePdf,
  generateThumbnail,
  getPageTextBlocks,
  getPageViewportSizes,
  renderPage,
  renderPageTile,
  type AcquiredPdfDocument,
  type PageSize,
} from '../Viewer/pdfManager';
import type { TileDescriptor } from '../Viewer/tiling';
import type { ViewMode } from 'src/models/docPage';
import { useEditorStore } from 'src/stores/editorStore';
import type { LayoutSide, PeekTarget } from 'src/stores/editorStore';
import { useHistoryStore } from 'src/stores/historyStore';
import { useRelationalStore } from 'src/stores/relationalStore';
import { useGroupStore } from 'src/stores/groupStore';
import { useDocumentSearch } from './composables/useDocumentSearch';
import { annotationTextItemsByPage, searchMatchDomId } from 'src/utils/document/textSearch';
import type { TextItemBox } from 'src/models/document/pdf';
import type { TextSearchMatch } from 'src/models/document/search';
import type { ContainerElementFile, ContainerID } from 'src/models/container';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import { buildRelationalRule } from 'src/models/relational/ruleUtils';
import type { RelationalEndpointID } from 'src/models/relational/fileSchema';
import RelationalPeekDialog from 'src/components/DocLayout/RelationalPeekDialog.vue';
import {
  RELATIONAL_STATUS_MESSAGE_KEY,
  startRelationalDefine,
  decideRelationalOnAnnotationsAdded,
  decideRelationalOnSelectionChanged,
} from 'src/components/DocLayout/composables/useRelationalDefine';
import { useQuasar } from 'quasar';
import { saveDocument } from 'src/utils/document/saveDocument';
import { fileKey } from 'src/utils/document/fileKey';
import { confirmDialog } from 'src/components/Dialog/confirmDialog';
import { useAnnotationActions } from './composables/useAnnotationActions';
import { useAnnotationHistory } from './composables/useAnnotationHistory';
import { useZoomControl } from './composables/useZoomControl';
import { ANNOTATION_GEOMETRY } from 'src/components/Viewer/Annotation/annotationGeometry';
import {
  MAX_ZOOM,
  PAGE_LIST_INITIAL_ZOOM,
  PAGE_LIST_MAX_ZOOM,
} from 'src/components/Viewer/zoomSteps';

interface Prop {
  file: ContainerElementFile;
  layoutSide: LayoutSide;
}
const prop = defineProps<Prop>();
const viewer = useTemplateRef('viewer');
const documentViewer = useTemplateRef<InstanceType<typeof DocumentViewer>>('documentViewer');
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
const groupStore = useGroupStore();
const history = useAnnotationHistory();

// TODO: PDFの読み込みに失敗した場合、Loading画面を抜けてエラーが起きた旨を通知する仕様に修正
const loading = ref<boolean>(true);

// for document
type RenderFunc = (
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number,
) => Promise<PageSize>;
const onRender = ref<RenderFunc>();
// 最初のページ描画（PdfPageのonMounted内でonRenderが呼ばれ、layoutSizeが確定する瞬間）が
// 完了するまで解決しないPromise。単一表示モードでは、これが解決するまで`.page-outer`の
// 実際のサイズ（outerStyle）が確定せず、viewerContainerがスクロール可能な状態にならないため、
// 保存済みスクロール位置の復元前に必ずこれを待つ
let resolveFirstRenderReady: (() => void) | undefined;
const firstRenderReady = new Promise<void>((resolve) => {
  resolveFirstRenderReady = resolve;
});
type RenderTileFunc = (
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number,
  tile: TileDescriptor,
  dpr: number,
) => Promise<void>;
const onRenderTile = ref<RenderTileFunc>();
type GenerateThumbnailFunc = (pageNumber: number, maxWidth: number) => Promise<string>;
const onGenerateThumbnail = ref<GenerateThumbnailFunc>();
// 選択可能なテキストレイヤー（issue #33）用に、指定ページのテキストアイテム一覧を返す
type GetPageTextBlocksFunc = (pageNumber: number) => Promise<TextItemBox[]>;
const onGetPageTextBlocks = ref<GetPageTextBlocksFunc>();

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

// このタブに記録済みの最終表示状態（ページ・表示モード・ズーム倍率・スクロール位置。
// タブの再選択・再オープン後の復元用）。`initialTabFocus`（関係性ダイアログ等からの
// 明示的なページ遷移要求）が優先される
const storedTabViewState = editorStore.getTabViewState(prop.file);

const currentPage = ref(initialTabFocus?.page ?? storedTabViewState?.lastPage ?? 1);
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
const viewMode = ref<ViewMode>(storedTabViewState?.viewMode ?? 'single');
// ページ一覧モード以外で直近まで表示していた表示モード。ページ一覧のセルをクリックした際、
// 一覧画面ではなく直前まで見ていた表示モードのそのページへ戻るために使う
const lastContentViewMode = ref<ViewMode>('single');
// ページ一覧モードはサムネイルの解像度が低く高倍率にする意味が無いため、拡大率上限を
// 通常モードより低く絞る（ズームスライダー・入力・ズームインボタンすべてに反映する）
const zoomMax = computed(() => (viewMode.value === 'pageList' ? PAGE_LIST_MAX_ZOOM : MAX_ZOOM));
const { zoomLevel, setZoomLevel, zoomIn, zoomOut, fitToWidth, fitToPage } = useZoomControl({
  viewer,
  documentViewer,
  currentPage,
  pageSizes,
  maxZoom: zoomMax,
});
if (storedTabViewState !== undefined) zoomLevel.value = storedTabViewState.zoomLevel;

// ============ 文書内テキスト検索（Ctrl+F、issue #33） ============

const {
  isOpen: searchOpen,
  query: searchQuery,
  searchOptions,
  activeMatch: searchActiveMatch,
  matches: searchMatches,
  activeIndex: searchActiveIndex,
  matchCount: searchMatchCount,
  isSearching: searchIsSearching,
  goToNext: searchGoToNext,
  goToPrevious: searchGoToPrevious,
  open: openSearch,
  close: closeSearch,
} = useDocumentSearch({
  getDocument: () => acquiredPdf?.document,
  onNavigate: (match) => void scrollToSearchMatch(match),
  // アノテーションのテキストボックス内容もPDF自体のテキストと同様に検索対象へ含める
  getExtraItemsByPage: () => annotationTextItemsByPage(annotations.value),
});
const activeSearchMatchId = computed(() =>
  searchActiveMatch.value ? searchMatchDomId(searchActiveMatch.value) : undefined,
);

/**
 * 検索マッチへ実際にジャンプする（ページ移動 + そのページ内でのハイライト位置へのスクロール）
 *
 * ページ切り替え直後はPdfPage側の非同期処理（canvas描画・テキストブロック取得）が完了するまで
 * ハイライト矩形のDOM要素がまだ存在しないため、要素が見つかるまで短い間隔でリトライする
 */
async function scrollToSearchMatch(match: TextSearchMatch): Promise<void> {
  goToPage(match.pageNumber);
  const id = searchMatchDomId(match);
  const MAX_ATTEMPTS = 20;
  const RETRY_INTERVAL_MS = 50;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await nextTick();
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
  }
}

// for relational peek dialog
const peekTarget = ref<PeekTarget>();
const peekDialogOpen = ref(false);

/**
 * 現在の選択から、関係性の簡易閲覧ダイアログを開く対象を決定する
 *
 * 選択が1件の場合はそのアノテーション、選択が既存グループの全メンバーとちょうど一致する場合は
 * そのグループを対象にする。それ以外（未選択・部分選択）はundefined（ダイアログを開かない）
 */
function resolvePeekTarget(): PeekTarget | undefined {
  const ids = selectedAnnotationIds.value;
  if (ids.length === 1) return { kind: 'annotation', id: ids[0]! };
  if (ids.length > 1) {
    const group = groupStore.matchingGroup(fileKey(prop.file), ids);
    if (group !== undefined) return { kind: 'group', id: group.id };
  }
  return undefined;
}

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
      // 文書自体を開けなかった異常系のため、ピン留めされていても閉じる
      editorStore.closeTab(prop.file, prop.layoutSide, true);
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
    const result = await renderPage(
      loadedDocument,
      pageNumber,
      canvas,
      scale,
      0,
      fileKey(prop.file),
    );
    resolveFirstRenderReady?.();
    resolveFirstRenderReady = undefined;
    return result;
  };
  /** PDFページの指定タイルをレンダリングする。 */
  onRenderTile.value = async (
    pageNumber: number,
    canvas: HTMLCanvasElement,
    scale: number,
    tile: TileDescriptor,
    dpr: number,
  ): Promise<void> => {
    await renderPageTile(loadedDocument, pageNumber, canvas, scale, tile, dpr, fileKey(prop.file));
  };
  onGenerateThumbnail.value = (pageNumber: number, maxWidth: number): Promise<string> => {
    return generateThumbnail(loadedDocument, pageNumber, maxWidth);
  };
  onGetPageTextBlocks.value = (pageNumber: number): Promise<TextItemBox[]> => {
    return getPageTextBlocks(loadedDocument, pageNumber);
  };

  loading.value = false;
}

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
 * ページ一覧モードのセルがクリックされた際、直前まで表示していた表示モードへ戻り、
 * クリックされたページへ移動する
 */
const onSelectPageFromList = (page: number): void => {
  viewMode.value = lastContentViewMode.value;
  goToPage(page);
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

/**
 * 指定したアノテーションが画面中央に来るよう、ページ内の位置までスクロールする
 *
 * `scrollToCurrentPage`（ページ単位の近似スクロール）だけでは、ページ内のどこにアノテーションが
 * あるかまでは考慮されない（長いページの下部にあるアノテーションが画面外のままになる）ため、
 * ブックマーク・関係性ダイアログからのジャンプ（`pendingTabFocus.annotId`）専用にこちらで補う。
 * `currentPage`を対象アノテーションのページへ既に移動済みであることが前提
 */
async function scrollToAnnotation(annotId: AnnotationID) {
  const annotation = annotations.value.find((a) => a.id === annotId);
  if (!annotation || !viewer.value) return;

  // ページ要素自体（`documentViewer`側のズームアンカー計算用矩形）が実際のレイアウトに
  // 反映されるのを待つ（表示モード切替・ページ切替直後はDOMパッチが未反映の場合があるため）
  await nextTick();
  const pageRect = documentViewer.value?.getAnchorRect();
  if (!pageRect) return;

  const scale = zoomLevel.value / 100;
  const bbox = ANNOTATION_GEOMETRY[annotation.type].boundingBox(annotation);
  const wrapperRect = viewer.value.getBoundingClientRect();

  const annotCenterX =
    pageRect.left - wrapperRect.left + viewer.value.scrollLeft + (bbox.x + bbox.width / 2) * scale;
  const annotCenterY =
    pageRect.top - wrapperRect.top + viewer.value.scrollTop + (bbox.y + bbox.height / 2) * scale;

  viewer.value.scrollTo({
    left: Math.max(0, annotCenterX - wrapperRect.width / 2),
    top: Math.max(0, annotCenterY - wrapperRect.height / 2),
  });
}

// ================================

/**
 * 待機中の基準端点と対象端点（いずれもアノテーションまたはグループ）の間に関係性を登録する
 */
async function finishRelational(targetId: RelationalEndpointID) {
  const srcId = editorStore.relationalPendingId;
  const mode = editorStore.relationalMode;
  const pendingFile = editorStore.relationalPendingFile;
  if (srcId === undefined || mode === undefined) return;
  if (srcId === targetId) return; // 自分自身との関係性は無視

  // 通知や待機状態は結果を待たずに解除する。連続定義モードでない限りモード自体も終了し、
  // 次に選択・作成されたアノテーションが新たな1つ目として誤って待機開始する（＝関係性の
  // 二重登録につながる）のを防ぐ
  editorStore.finishRelationalPending();
  // 連続定義モードが、選択され続けているだけのこの対象を新たな起点と誤認しないための目印
  editorStore.relationalLastPairedId = targetId;

  const relational = {
    srcID: srcId,
    targetID: targetId,
    rule: buildRelationalRule(mode),
  };
  const res = await api.registRelationals(relational);
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
  // targetId（=このタブのファイルに属する側の端点）を基準にUndo履歴へ記録する
  history.recordRelationalCreated(prop.file, relational, targetId);

  // 連続定義モード（関係性ボタンのダブルクリックで開始）が有効な場合、モード自体は
  // `finishRelationalPending`により維持される。次に選択されたアノテーションを新たな
  // 基準とする処理は`RelationalDefineButtons.vue`側で選択変化を監視して行う
  // （1組確定するごとに直前の対象と自動で連鎖させるのではなく、次の選択を独立した
  // 新しいペアの起点として扱うため）

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
  const oldAnnotIds = new Set(oldAnnots.map((annot) => annot.id));
  const addedIds = newAnnots.filter((annot) => !oldAnnotIds.has(annot.id)).map((annot) => annot.id);

  const decision = decideRelationalOnAnnotationsAdded(
    mode,
    editorStore.relationalPendingId,
    addedIds,
    editorStore.relationalLastPairedId,
  );
  if (decision === undefined || mode === undefined) return;

  if (decision.action === 'start') {
    // 1つ目のアノテーション：対になるアノテーションの待機モードへ移行
    startRelationalDefine(editorStore, t, mode, decision.annotId, prop.file);
    return;
  }

  // 2つ目のアノテーション：待機中の関係性を確定
  await finishRelational(decision.annotId);
}

/**
 * アノテーションの選択を検知し、待機中の関係性を確定する
 *
 * 関係性の待機状態（`relationalPendingId`等）はペイン単位ではなくeditorStoreのグローバルな
 * 状態のため、同一ファイルを複数ペインに開いている場合、非アクティブ側のペインもこの
 * ファイルのアノテーション変化・選択変化を検知できてしまう。ここでガードせずに両ペインが
 * 独立して確定処理を実行すると、`api.registRelationals`が二重に呼ばれて関係性が重複登録
 * されたり、一方が待機を解除した直後にもう一方が古い状態を見て待機を再開してしまい
 * 「対になるアノテーションを選択しても待機状態が解除されない」ように見える不具合につながる。
 *
 * そのため、実際にこのペインでユーザーが新たにアノテーションを選択したかどうかを、選択変更前後の
 * IDの差分（新規に加わったIDがあるか）で判定する。アノテーション一覧購読の再通知（DB更新の
 * エコー）による`selectedAnnotationIds`の再代入は、既存の選択からIDが減ることはあっても
 * 増えることはないため、この判定でアクティブペインかどうかに関わらず確実に除外できる。
 * （`editorStore.activeSide`で判定していた旧実装は、クリックによる選択確定＝mousedownの直後の
 * 時点ではまだそのペインの`.document-layout`の`click`イベントが発火しておらず`activeSide`が
 * 更新されていないため、「他ペインのアノテーションを直接選択する」操作を常に取りこぼしていた）
 */
async function registRelationalBySelect(
  selectedIds: AnnotationID[],
  oldSelectedIds: AnnotationID[],
) {
  const hasNewSelection = selectedIds.some((id) => !oldSelectedIds.includes(id));
  if (!hasNewSelection) return;

  const targetId = decideRelationalOnSelectionChanged(
    editorStore.relationalMode,
    editorStore.relationalPendingId,
    selectedIds,
    (id) => groupStore.memberSet(fileKey(prop.file), id) ?? new Set([id as AnnotationID]),
    (ids) => groupStore.matchingGroup(fileKey(prop.file), ids)?.id,
  );
  if (targetId === undefined) return;

  await finishRelational(targetId);
}

/**
 * アノテーション一覧の変化に応じて、待機解除・待機開始・関係性確定を判断する
 */
async function handleAnnotationsChanged(
  newAnnots: AnnotationStyle[],
  oldAnnots: AnnotationStyle[],
  originSide: LayoutSide,
) {
  // 待機中の基準端点（アノテーションまたはグループ）が（このファイル内で）削除された場合は
  // 待機を解除する。基準がグループの場合、そのグループのIDはnewAnnotsのどのアノテーションの
  // idとも一致しないため、アノテーション一覧だけでなくgroupStoreのキャッシュも確認する
  // （groupStore側の判定に頼るため、実際の基準端点の削除だけでなく、グループの解散・
  // メンバー変更によるgroupStore更新のタイミング次第でここに来る点に注意）
  const pendingId = editorStore.relationalPendingId;
  const pendingEndpointStillExists =
    pendingId === undefined ||
    newAnnots.some((annot) => annot.id === pendingId) ||
    // pendingIdがグループ自身のIDである場合の判定。groupContainingはメンバーシップ一致でも
    // trueを返すため使わず、グループID自体の完全一致のみを見る（メンバー一致で判定すると、
    // アノテーション削除〜groupStore.refreshFile完了までの間、削除済みメンバーがまだ
    // 古いグループレコードのmemberIdsに残っていることで誤って「存在する」と判定してしまう）
    groupStore.groupsByFileKey[fileKey(prop.file)]?.some((g) => g.id === pendingId) === true;
  if (pendingId !== undefined && isRelationalPendingFile() && !pendingEndpointStillExists) {
    editorStore.cancelRelationalPending();
    return;
  }

  // 待機開始・確定は、アノテーション変更が発生した時点で操作していたペイン（originSide）でのみ扱う
  // originSide を渡すことで、非同期処理の間に activeSide が変化しても発生元のペインだけが処理を行う
  if (originSide === prop.layoutSide) {
    await registRelationalByAdd(newAnnots, oldAnnots);
  }

  // アノテーション内容（OCR結果）の読み込み完了時にもこのイベントが発火するため、
  // ここで再検証しておくことで「検証保留」から自動的にOK/NGへ遷移する。
  // ただし、Undo/Redo実行中（historyStore.isBusy）はuseAnnotationHistory側の各コマンドが
  // 処理の最後に必ず自分で関係性キャッシュを再検証してから完了するため、ここで重ねて
  // 呼ぶと同じファイルの全関係性（OCR照合を含む）を1回のUndo/Redoにつき2回検証してしまい、
  // 関係性を多く持つ文書ほどUndo/Redoがもっさりする原因になっていた。isBusy中はスキップし、
  // Undo/Redoに由来しない変化（他ユーザー・OCR非同期読み込み等）の場合のみ実行する
  if (!historyStore.isBusy(prop.file)) {
    void relationalStore.refreshFile(prop.file);
  }

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

  const isModifierPressed = e.ctrlKey || e.metaKey;

  // Ctrl+Fは検索バーの入力欄にフォーカスが乗っている間も奪う必要がある（さもないと検索バーを
  // 開いた直後にCtrl+Fを押すとブラウザ標準のページ内検索が開いてしまう）ため、
  // 下のテキスト入力中の早期returnより先に判定する
  if (isModifierPressed && e.key.toLowerCase() === 'f') {
    // ブラウザ標準のページ内検索と衝突するため必ずpreventDefaultする（issue #33）
    e.preventDefault();
    openSearch();
    return;
  }

  const activeEl = document.activeElement;
  const isTextInput =
    activeEl instanceof HTMLElement &&
    (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);
  if (isTextInput) return;

  if (e.code === 'Space') {
    const target = resolvePeekTarget();
    if (target === undefined) return;
    e.preventDefault();
    peekTarget.value = target;
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
  void groupStore.refreshFile(prop.file);
  window.addEventListener('keydown', handleGlobalKeydown);

  if (initialTabFocus !== undefined) {
    // ページ番号自体は既にcurrentPageの初期値へ反映済み。ここではpageCount確定後の
    // クランプ（同じ値であれば再代入しても再描画は発生しない）とアノテーション選択・
    // スクロールのみを行う
    goToPage(initialTabFocus.page);
    if (initialTabFocus.annotId !== undefined) {
      selectedAnnotationIds.value = [initialTabFocus.annotId];
      // 'hand'モードのままだとAnnotationLayer側がisEditingModeをfalseと判定し、
      // Transformerの枠線が一切描画されない（選択状態は反映されても見た目上判別できない）ため、
      // ブックマーク等からのジャンプで選択を伴う場合は必ずポインタモードへ切り替える
      editorStore.currentTools = 'pointer';
    }
    await scrollToCurrentPage(viewer.value?.scrollHeight ?? 0);
    if (initialTabFocus.annotId !== undefined) {
      await scrollToAnnotation(initialTabFocus.annotId);
    }
  } else if (storedTabViewState !== undefined) {
    // 明示的な遷移要求がない場合、前回このタブを表示していた際の状態へ復元する
    // （ページ番号自体は既にcurrentPageの初期値へ反映済みのため、ここではpageCount確定後の
    // クランプのみ行う）。スクロール位置（連続表示モードではページ位置＋ページ内の閲覧領域、
    // 単一表示モードではズーム時のパン位置に相当）は、ページ番号からの近似計算より
    // 保存しておいた実際のscrollLeft/scrollTopをそのまま復元する方が正確なため、
    // `scrollToCurrentPage`の近似スクロールは行わずこちらで直接設定する
    goToPage(storedTabViewState.lastPage);
    // `nextTick()`はVue側のDOMパッチ完了を保証するのみで、PdfPage内で非同期に行われる
    // 実際のページ描画（`.page-outer`の実サイズ確定）までは保証しない。単一表示モードでは
    // それより前にscrollLeft/scrollTopを代入しても、viewerContainerがまだスクロール可能な
    // サイズになっておらずブラウザ側で0にクランプされてしまうため、必ず先に描画完了を待つ
    // （読み込み失敗時はonRenderが設定されずPdfPage自体が描画されないため、その場合は待たない）
    if (onRender.value !== undefined) await firstRenderReady;
    await nextTick();
    if (viewer.value) {
      viewer.value.scrollLeft = storedTabViewState.scrollLeft;
      viewer.value.scrollTop = storedTabViewState.scrollTop;
    }
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
  if (pending.annotId !== undefined) {
    selectedAnnotationIds.value = [pending.annotId];
    // initialTabFocus側と同様、'hand'モードのままだとTransformerの枠線が表示されないため
    // ポインタモードへ切り替える
    editorStore.currentTools = 'pointer';
  }
  await scrollToCurrentPage(viewer.value?.scrollHeight ?? 0);
  if (pending.annotId !== undefined) await scrollToAnnotation(pending.annotId);
}

watch(annotations, (newAnnots, oldAnnots) => {
  // ガードはイベント発生時点のアクティブペインに紐づけて扱う
  // （非同期処理の間に editorStore.activeSide が変化しても、発生元のペインでのみ
  //  処理が実行されるようにする）
  const originSide = editorStore.activeSide;
  void handleAnnotationsChanged(newAnnots, oldAnnots, originSide);
});
watch(selectedAnnotationIds, (selectedIds, oldSelectedIds) => {
  void registRelationalBySelect(selectedIds, oldSelectedIds);
});
// 現在表示中のページ番号を、Explorerのブックマークパネル等このコンポーネントの外側からも
// 参照できるようeditorStoreへ橋渡しする（「現在のページをブックマーク」の既定ページに使う）
watch(currentPage, (page) => editorStore.setActiveTabCurrentPage(prop.layoutSide, page), {
  immediate: true,
});

// アクティブなペインの選択状態を、スタイルパネル（MainTools/SubTools行）用にeditorStoreへ橋渡しする。
// 選択状態自体はペインごとのこのコンポーネントが持つため、layerOrderAction等と同じ
// 「意図・状態をeditorStoreに反映する」パターンを踏襲する。
//
// 同一ファイルが複数ペインに開かれている場合、非アクティブ側のペインでもアノテーション一覧の
// 購読（`observedAnnotationStylesByFile`）が更新のたびに再発火し、`selectedAnnotations`が
// （内容が変わらなくても）新しい配列参照として再計算されてこのwatchを起動させてしまう。
// ファイル一致だけで解除条件を判定すると、そのたびに非アクティブ側が「自分は非アクティブだから」
// と誤ってアクティブ側の選択を解除してしまい、値を変更するたびに編集ツールバーが点滅・消失する
// 不具合につながる。解除は必ず「自分が最後にこの選択をセットした本人（side一致）」の場合のみ行う
watch(
  [selectedAnnotations, () => editorStore.activeSide],
  () => {
    if (editorStore.activeSide === prop.layoutSide) {
      editorStore.setActiveSelection(prop.file, selectedAnnotations.value, prop.layoutSide);
    } else if (editorStore.activeSelection?.side === prop.layoutSide) {
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
  () => editorStore.peekRequestedTarget,
  (target) => {
    if (target === undefined) return;
    if (editorStore.activeSide !== prop.layoutSide) return;
    // 他ペインの誤反応防止: 対象がこのファイルに実在するか確認する
    const existsHere =
      target.kind === 'annotation'
        ? annotations.value.some((a) => a.id === target.id)
        : groupStore.groupContaining(fileKey(prop.file), target.id) !== undefined;
    if (!existsHere) return;
    peekTarget.value = target;
    peekDialogOpen.value = true;
    editorStore.clearPeekRequest();
  },
);
// アノテーション右クリックメニューの「グループ化」からの意図をここで実行する
// （deleteRequestedと同じパターン）
watch(
  () => editorStore.groupRequested,
  (requested) => {
    if (!requested) return;
    if (editorStore.activeSide !== prop.layoutSide) return;
    void annotationActions.groupSelected().finally(() => {
      editorStore.clearGroupRequest();
    });
  },
);
// アノテーション右クリックメニューの「グループ化を解除」からの意図をここで実行する
// （groupRequestedと同じパターン）
watch(
  () => editorStore.ungroupRequested,
  (requested) => {
    if (!requested) return;
    if (editorStore.activeSide !== prop.layoutSide) return;
    void annotationActions.ungroupSelected().finally(() => {
      editorStore.clearUngroupRequest();
    });
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
// ページ一覧モード以外に変化するたびに記録しておく（ページ一覧のセルクリック時に戻り先として使う）
watch(viewMode, (mode) => {
  if (mode !== 'pageList') lastContentViewMode.value = mode;
});
// ページ一覧モードへ入った際は直前の拡大率を退避して規定倍率から表示し、抜けた際は元の倍率へ戻す
// （ページ一覧は俯瞰用途のため、直前がどれだけ拡大されていても常に同じ見え方で開始したい）
let zoomLevelBeforePageList: number | undefined;
watch(viewMode, (mode, oldMode) => {
  if (mode === 'pageList' && oldMode !== 'pageList') {
    zoomLevelBeforePageList = zoomLevel.value;
    setZoomLevel(PAGE_LIST_INITIAL_ZOOM);
  } else if (mode !== 'pageList' && oldMode === 'pageList') {
    if (zoomLevelBeforePageList !== undefined) setZoomLevel(zoomLevelBeforePageList);
    zoomLevelBeforePageList = undefined;
  }
});
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
  // このタブの表示状態をeditorStoreへ記録し、タブの再選択・再オープン後に復元できるようにする。
  // reactiveなwatchで都度保存するのではなく、タブを離れる（＝このコンポーネントが破棄される）
  // 直前の状態を1回だけ保存する。scrollLeft/scrollTopは実DOM値を直接読むため、
  // watch経由で追いかけるより確実（Vueのreactivityフラッシュ前にアンマウントされ、
  // 最後の変化が保存されないまま失われる、といった心配が無い）
  editorStore.setTabViewState(prop.file, {
    lastPage: currentPage.value,
    viewMode: viewMode.value,
    zoomLevel: zoomLevel.value,
    scrollLeft: viewer.value?.scrollLeft ?? 0,
    scrollTop: viewer.value?.scrollTop ?? 0,
  });

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
  // （sideで判定することで、同一ファイルを開く別ペインの選択を誤って解除しないようにする）
  if (editorStore.activeSelection?.side === prop.layoutSide) {
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
  // SearchBarの position: absolute の基準（スクロールする.document-viewer-wrapperではなく
  // ここを基準にすることで、検索バーが文書のスクロールに巻き込まれず常に同じ位置に留まる）
  position: relative;
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
