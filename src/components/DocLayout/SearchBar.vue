<template>
  <!-- 文書内テキスト検索（Ctrl+F）バー。issue #33の要件1（文書内検索）・要件2（コンテナ横断検索、
       「できれば」の追加要件）に対応する。ハイライト・スクロール自体は親（DocumentTabView.vue）が
       activeMatch/matchesをPdfPageへ渡して行うため、ここでは検索クエリの入力とナビゲーションUIに徹する -->
  <div class="search-bar">
    <q-card flat bordered class="search-bar__card">
      <div class="search-bar__row">
        <q-icon name="search" size="20px" class="q-mr-sm" />
        <input
          ref="inputRef"
          :value="query"
          type="text"
          class="search-bar__input"
          :placeholder="$t('pdfEditor.search.placeholder')"
          @input="onInput"
          @keydown="onKeydown"
        />
        <span class="search-bar__count">
          <q-spinner v-if="isSearching" size="16px" />
          <template v-else>{{ matchCountLabel }}</template>
        </span>
        <q-btn
          flat
          dense
          round
          size="sm"
          icon="keyboard_arrow_up"
          :disable="matchCount === 0"
          :title="$t('pdfEditor.search.previous')"
          @click="emit('previous')"
        />
        <q-btn
          flat
          dense
          round
          size="sm"
          icon="keyboard_arrow_down"
          :disable="matchCount === 0"
          :title="$t('pdfEditor.search.next')"
          @click="emit('next')"
        />
        <q-btn
          flat
          dense
          round
          size="sm"
          icon="close"
          :title="$t('pdfEditor.search.close')"
          @click="emit('close')"
        />
      </div>

      <!-- コンテナ横断検索（issue #33の「できれば」要件）: 現在のクエリでコンテナ内の全PDFを検索する。
           キーストロークごとの自動実行は行わず、明示的なボタン操作でのみ実行する
           （多数ファイルを毎回全走査すると重くなるため） -->
      <div class="search-bar__container-row">
        <q-btn
          flat
          dense
          no-caps
          size="sm"
          icon="folder_open"
          :label="$t('pdfEditor.search.searchContainer')"
          :disable="query.trim() === '' || isContainerSearching"
          :loading="isContainerSearching"
          @click="runContainerSearch"
        />
      </div>

      <q-list v-if="containerResultsVisible" dense bordered class="search-bar__results">
        <q-item v-if="containerResults.length === 0" class="search-bar__results-empty">
          <q-item-section>{{ $t('pdfEditor.search.containerNoMatches') }}</q-item-section>
        </q-item>
        <template v-for="result in containerResults" :key="fileKeyOf(result.file)">
          <q-item
            v-for="(match, idx) in result.matches"
            :key="`${fileKeyOf(result.file)}-${idx}`"
            clickable
            @click="openContainerResult(result.file, match.pageNumber)"
          >
            <q-item-section>
              <q-item-label>{{ result.file.path }}</q-item-label>
              <q-item-label caption>
                {{ $t('pdfEditor.search.pageLabel', { page: match.pageNumber }) }}
                — {{ match.text }}
              </q-item-label>
            </q-item-section>
          </q-item>
        </template>
      </q-list>
    </q-card>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useBackendApi } from 'src/apis/backendApi';
import { useEditorStore } from 'src/stores/editorStore';
import { fileKey } from 'src/utils/document/fileKey';
import type { ContainerElementFile, ContainerID } from 'src/models/container';
import type { ContainerTextSearchResult } from 'src/models/document/search';

interface Props {
  /** 検索クエリ（v-model） */
  query: string;
  matchCount: number;
  /** 現在アクティブなマッチの0始まりインデックス（表示用。matchCountが0の場合は無視される） */
  activeIndex: number;
  isSearching: boolean;
  /** コンテナ横断検索の対象コンテナ */
  containerID: ContainerID;
}
const props = defineProps<Props>();
const emit = defineEmits<{
  'update:query': [value: string];
  next: [];
  previous: [];
  close: [];
}>();

const { t } = useI18n();
const api = useBackendApi();
const editorStore = useEditorStore();

const inputRef = ref<HTMLInputElement | null>(null);
onMounted(() => {
  // 検索バーが開いた瞬間、即座に入力できるようフォーカスする
  void nextTick(() => inputRef.value?.focus());
});

function onInput(e: Event): void {
  emit('update:query', (e.target as HTMLInputElement).value);
}

/** Enter/Shift+Enterでのマッチ間ナビゲーション、Escでの検索バー終了をまとめて扱う */
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (e.shiftKey) emit('previous');
    else emit('next');
  } else if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
  }
}

const matchCountLabel = computed(() => {
  if (props.matchCount === 0) return t('pdfEditor.search.noMatches');
  return t('pdfEditor.search.matchCount', {
    current: props.activeIndex + 1,
    total: props.matchCount,
  });
});

// ============ コンテナ横断検索 ============

const containerResults = ref<ContainerTextSearchResult[]>([]);
const isContainerSearching = ref(false);
const containerResultsVisible = ref(false);

function fileKeyOf(file: ContainerElementFile): string {
  return fileKey(file);
}

/** 現在のqueryでコンテナ内の全PDF文書を検索する（issue #33の「できれば」要件） */
async function runContainerSearch(): Promise<void> {
  const trimmed = props.query.trim();
  if (trimmed === '') return;

  isContainerSearching.value = true;
  containerResultsVisible.value = true;
  try {
    const res = await api.searchContainerText(props.containerID, trimmed);
    containerResults.value = res.ok ? res.data : [];
  } finally {
    isContainerSearching.value = false;
  }
}

/** コンテナ横断検索の結果をクリックした際、該当文書の該当ページをタブで開く */
function openContainerResult(file: ContainerElementFile, pageNumber: number): void {
  editorStore.openTab(file, pageNumber);
}
</script>

<style scoped lang="scss">
.search-bar {
  position: absolute;
  top: 8px;
  right: 24px;
  z-index: 20;
}

.search-bar__card {
  background: white;
  padding: 4px 8px;
  min-width: 320px;
  max-width: 420px;
}

.body--dark .search-bar__card {
  background: $dark;
}

.search-bar__row {
  display: flex;
  align-items: center;
  gap: 2px;
}

.search-bar__input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 14px;
  min-width: 120px;
  color: inherit;
}

.search-bar__count {
  font-size: 12px;
  color: $grey-7;
  white-space: nowrap;
  padding: 0 4px;
  display: flex;
  align-items: center;
}

.search-bar__container-row {
  display: flex;
  justify-content: flex-end;
  padding-top: 2px;
}

.search-bar__results {
  max-height: 260px;
  overflow-y: auto;
  margin-top: 4px;
}

.search-bar__results-empty {
  color: $grey-6;
  font-size: 12px;
}
</style>
