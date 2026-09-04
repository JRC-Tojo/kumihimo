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
import type { TextItemBox } from 'src/models/document/pdf';
import type { TextSearchMatch } from 'src/models/document/search';
import { TextSearchOptions } from 'src/models/document/search';

/** 検索の度にキー入力を待つデバウンス時間（ミリ秒） */
const SEARCH_DEBOUNCE_MS = 300;

export interface UseDocumentSearchOptions {
  /** 検索対象のPDF文書を取得する（呼び出し時点で最新のacquired文書を参照できるよう関数で受け取る） */
  getDocument: () => PdfDocument | undefined;
  /** マッチへジャンプする際に呼ばれる（ページ移動・スクロールは呼び出し側の責務） */
  onNavigate: (match: TextSearchMatch) => void;
  /**
   * PDF自体のテキストに加えて検索対象へ含めたいテキストアイテムを、ページ番号ごとに返す
   * （アノテーションのテキストボックス内容等）。呼び出し時点の最新状態を参照できるよう関数で受け取る
   */
  getExtraItemsByPage?: () => Map<number, TextItemBox[]>;
}

export function useDocumentSearch(options: UseDocumentSearchOptions) {
  /** 検索バー自体の表示状態（Ctrl+Fで開く、Escで閉じる） */
  const isOpen = ref(false);
  const query = ref('');
  const matches = ref<TextSearchMatch[]>([]);
  const activeIndex = ref(0);
  const isSearching = ref(false);
  /** 大文字小文字・半角全角・正規表現の扱い（検索バーのトグルボタンからv-modelされる） */
  const searchOptions = ref<TextSearchOptions>(TextSearchOptions.parse({}));

  const activeMatch = computed<TextSearchMatch | undefined>(() => matches.value[activeIndex.value]);
  const matchCount = computed(() => matches.value.length);

  /**
   * 実行中の検索が最新のものかどうかを判定する世代カウンタ。
   * `searchDocumentText`はデバウンス経由で連続して呼ばれ得るため、後発の検索が始まった後に
   * 先発の検索が完了しても、その結果で現在の状態を上書きしないようにする（クエリ変更・
   * 検索バーを閉じた後に古い検索が完了するケースを含む）
   */
  let searchGeneration = 0;

  /**
   * 現在のqueryで実際に検索を実行する（デバウンスなし版。Enter即時確定等から直接呼ぶ用）
   *
   * ページ単位の完了ごとに`matches`へ追記していく（全ページの完了を待たない）ため、
   * ページ数の多い巨大なPDFを検索してもヒットが見つかった時点からUIに反映され、
   * 検索バーがブロックされたように見える時間を短縮できる
   */
  async function runSearch(): Promise<void> {
    const generation = ++searchGeneration;
    const pdf = options.getDocument();
    const trimmed = query.value.trim();
    matches.value = [];
    activeIndex.value = 0;
    if (!pdf || trimmed === '') return;

    isSearching.value = true;
    let navigatedToFirst = false;
    try {
      await searchDocumentText(pdf, trimmed, {
        searchOptions: searchOptions.value,
        extraItemsByPage: options.getExtraItemsByPage?.(),
        onPageMatches: (_pageNumber, pageMatches) => {
          if (generation !== searchGeneration || pageMatches.length === 0) return;
          matches.value.push(...pageMatches);
          if (!navigatedToFirst) {
            navigatedToFirst = true;
            const first = pageMatches[0];
            if (first !== undefined) options.onNavigate(first);
          }
        },
      });
    } finally {
      if (generation === searchGeneration) isSearching.value = false;
    }
  }

  const debouncedRunSearch = debounce(() => void runSearch(), SEARCH_DEBOUNCE_MS);
  // 入力欄はqueryへ直接v-modelできるようにし（呼び出し側での destructure を前提とした
  // useZoomControl等と同じ流儀）、実際の検索はキー入力のたびにデバウンスして実行する
  watch(query, () => debouncedRunSearch());
  // 検索オプション（大文字小文字・半角全角・正規表現）が変わった場合も、デバウンスなしで即座に検索し直す
  watch(searchOptions, () => void runSearch(), { deep: true });

  /** 次のマッチへ移動する（末尾からは先頭へ循環する） */
  function goToNext(): void {
    if (matches.value.length === 0) return;
    activeIndex.value = (activeIndex.value + 1) % matches.value.length;
    const match = matches.value[activeIndex.value];
    if (match !== undefined) options.onNavigate(match);
  }

  /** 前のマッチへ移動する（先頭からは末尾へ循環する） */
  function goToPrevious(): void {
    if (matches.value.length === 0) return;
    activeIndex.value = (activeIndex.value - 1 + matches.value.length) % matches.value.length;
    const match = matches.value[activeIndex.value];
    if (match !== undefined) options.onNavigate(match);
  }

  /** 検索バーを開く（Ctrl+F）。既に開いている場合は入力欄へのフォーカスのみ呼び出し側で行う */
  function open(): void {
    isOpen.value = true;
  }

  /** 検索バーを閉じ、検索状態を破棄する（Esc、閉じるボタン） */
  function close(): void {
    searchGeneration++; // 実行中の検索があれば、完了時に結果を適用させない
    isOpen.value = false;
    query.value = '';
    matches.value = [];
    activeIndex.value = 0;
  }

  return {
    isOpen,
    query,
    searchOptions,
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
