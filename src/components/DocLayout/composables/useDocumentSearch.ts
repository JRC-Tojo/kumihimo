/**
 * 文書内テキスト検索（Ctrl+F）の状態管理をまとめたコンポーザブル
 *
 * `DocumentTabView.vue`が保持する現在開いているPDF（`AcquiredPdfDocument`）に対して、
 * `src/components/Viewer/pdfManager.ts`の`searchDocumentText`を使い全ページを検索する。
 * ページ移動・スクロールなど実際のマッチへのジャンプ処理は呼び出し側（`onNavigate`）に委譲し、
 * ここでは検索クエリ・マッチ一覧・アクティブなマッチのインデックスの管理のみを担当する。
 *
 * 検索対象はキーストロークのたびに全ページを走査し直すため、「膨大なPDF文書」でも
 * 過度な負荷にならないよう`debounce`で入力確定を待ってから実行する
 */
import { computed, ref, watch } from 'vue';
import { debounce } from 'quasar';
import type { PdfDocument } from 'src/components/Viewer/pdfManager';
import { searchDocumentText } from 'src/components/Viewer/pdfManager';
import type { TextSearchMatch } from 'src/models/document/search';

/** 検索の度にキー入力を待つデバウンス時間（ミリ秒） */
const SEARCH_DEBOUNCE_MS = 300;

export interface UseDocumentSearchOptions {
  /** 検索対象のPDF文書を取得する（呼び出し時点で最新のacquired文書を参照できるよう関数で受け取る） */
  getDocument: () => PdfDocument | undefined;
  /** マッチへジャンプする際に呼ばれる（ページ移動・スクロールは呼び出し側の責務） */
  onNavigate: (match: TextSearchMatch) => void;
}

export function useDocumentSearch(options: UseDocumentSearchOptions) {
  /** 検索バー自体の表示状態（Ctrl+Fで開く、Escで閉じる） */
  const isOpen = ref(false);
  const query = ref('');
  const matches = ref<TextSearchMatch[]>([]);
  const activeIndex = ref(0);
  const isSearching = ref(false);

  const activeMatch = computed<TextSearchMatch | undefined>(() => matches.value[activeIndex.value]);
  const matchCount = computed(() => matches.value.length);

  /** 現在のqueryで実際に検索を実行する（デバウンスなし版。Enter即時確定等から直接呼ぶ用） */
  async function runSearch(): Promise<void> {
    const pdf = options.getDocument();
    const trimmed = query.value.trim();
    if (!pdf || trimmed === '') {
      matches.value = [];
      activeIndex.value = 0;
      return;
    }

    isSearching.value = true;
    try {
      matches.value = await searchDocumentText(pdf, trimmed);
    } finally {
      isSearching.value = false;
    }
    activeIndex.value = 0;
    if (matches.value.length > 0) options.onNavigate(matches.value[0]);
  }

  const debouncedRunSearch = debounce(() => void runSearch(), SEARCH_DEBOUNCE_MS);
  // 入力欄はqueryへ直接v-modelできるようにし（呼び出し側での destructure を前提とした
  // useZoomControl等と同じ流儀）、実際の検索はキー入力のたびにデバウンスして実行する
  watch(query, () => debouncedRunSearch());

  /** 次のマッチへ移動する（末尾からは先頭へ循環する） */
  function goToNext(): void {
    if (matches.value.length === 0) return;
    activeIndex.value = (activeIndex.value + 1) % matches.value.length;
    options.onNavigate(matches.value[activeIndex.value]);
  }

  /** 前のマッチへ移動する（先頭からは末尾へ循環する） */
  function goToPrevious(): void {
    if (matches.value.length === 0) return;
    activeIndex.value = (activeIndex.value - 1 + matches.value.length) % matches.value.length;
    options.onNavigate(matches.value[activeIndex.value]);
  }

  /** 検索バーを開く（Ctrl+F）。既に開いている場合は入力欄へのフォーカスのみ呼び出し側で行う */
  function open(): void {
    isOpen.value = true;
  }

  /** 検索バーを閉じ、検索状態を破棄する（Esc、閉じるボタン） */
  function close(): void {
    isOpen.value = false;
    query.value = '';
    matches.value = [];
    activeIndex.value = 0;
  }

  return {
    isOpen,
    query,
    matches,
    activeIndex,
    activeMatch,
    matchCount,
    isSearching,
    runSearch,
    goToNext,
    goToPrevious,
    open,
    close,
  };
}

export type DocumentSearch = ReturnType<typeof useDocumentSearch>;
