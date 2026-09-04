<template>
  <!-- コンテナ横断のテキスト検索パネル（VSCodeのサイドバー検索と同じ配置。issue由来の要望対応）。
       登録済みの全コンテナを対象に検索する。文書内のCtrl+F検索（SearchBar.vue）とは独立した状態を持つ -->
  <div class="search-view">
    <div class="search-view-header q-pa-sm">
      <div class="text-subtitle2">{{ $t('searchPanel.title') }}</div>
    </div>

    <div class="q-px-sm q-pb-xs">
      <q-input
        v-model="query"
        dense
        outlined
        clearable
        :placeholder="$t('searchPanel.placeholder')"
        @keydown.enter="runSearch"
      >
        <template #prepend>
          <q-icon name="search" />
        </template>
        <template #append>
          <q-spinner v-if="isSearching" size="18px" />
        </template>
      </q-input>
    </div>

    <!-- 検索オプション（大文字小文字・半角全角・正規表現）。文書内検索と同じ3種のトグルボタン -->
    <div class="search-view-options q-px-sm q-pb-sm">
      <q-btn
        flat
        dense
        round
        size="sm"
        label="Aa"
        class="search-view-option-btn"
        :class="{ 'search-view-option-btn--active': options.caseSensitive }"
        :title="$t('pdfEditor.search.matchCase')"
        @click="toggleOption('caseSensitive')"
      />
      <q-btn
        flat
        dense
        round
        size="sm"
        label="全/半"
        class="search-view-option-btn"
        :class="{ 'search-view-option-btn--active': options.ignoreWidth }"
        :title="$t('pdfEditor.search.ignoreWidth')"
        @click="toggleOption('ignoreWidth')"
      />
      <q-btn
        flat
        dense
        round
        size="sm"
        label=".*"
        class="search-view-option-btn"
        :class="{ 'search-view-option-btn--active': options.useRegex }"
        :title="$t('pdfEditor.search.useRegex')"
        @click="toggleOption('useRegex')"
      />
    </div>

    <q-separator />

    <div class="search-view-results">
      <div v-if="containers.length === 0" class="text-grey-6 text-caption q-pa-sm">
        {{ $t('searchPanel.noContainers') }}
      </div>
      <div
        v-else-if="hasSearched && !isSearching && results.length === 0"
        class="text-grey-6 text-caption q-pa-sm"
      >
        {{ $t('searchPanel.noResults') }}
      </div>
      <q-list v-else dense>
        <template v-for="result in results" :key="fileKey(result.file)">
          <q-item-label header class="search-view-file-header">
            {{ containerNameOf(result.file.containerID) }} › {{ result.file.path }}
          </q-item-label>
          <q-item
            v-for="(match, idx) in result.matches"
            :key="`${fileKey(result.file)}-${idx}`"
            clickable
            dense
            @click="openResult(result.file, match.pageNumber)"
          >
            <q-item-section>
              <q-item-label caption>
                {{ $t('searchPanel.pageLabel', { page: match.pageNumber }) }} — {{ match.text }}
              </q-item-label>
            </q-item-section>
          </q-item>
        </template>
      </q-list>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useBackendApi } from 'src/apis/backendApi';
import { useEditorStore } from 'src/stores/editorStore';
import { fileKey } from 'src/utils/document/fileKey';
import type { ContainerElementFile, ContainerID, ContainerSkel } from 'src/models/container';
import type { ContainerTextSearchResult, TextSearchOptions } from 'src/models/document/search';

const api = useBackendApi();
const editorStore = useEditorStore();

const query = ref('');
const options = ref<TextSearchOptions>({
  caseSensitive: false,
  ignoreWidth: false,
  useRegex: false,
});
const results = ref<ContainerTextSearchResult[]>([]);
const isSearching = ref(false);
const hasSearched = ref(false);
const containers = ref<ContainerSkel[]>([]);

/** キーストロークのたびの自動検索は行わない（全コンテナ×全文書の走査は重いため、Enter/オプション変更でのみ実行する） */
async function runSearch(): Promise<void> {
  const trimmed = query.value.trim();
  if (trimmed === '') {
    results.value = [];
    hasSearched.value = false;
    return;
  }

  const searchStartQuery = trimmed;
  const searchStartOptions = { ...options.value };
  isSearching.value = true;
  hasSearched.value = true;
  results.value = [];
  try {
    await api.searchAllContainersText(searchStartQuery, searchStartOptions, (result) => {
      // 検索中にクエリ・オプションが変わっていた場合、この結果は既に古いため反映しない
      if (
        query.value.trim() === searchStartQuery &&
        JSON.stringify(options.value) === JSON.stringify(searchStartOptions)
      ) {
        results.value.push(result);
      }
    });
  } finally {
    isSearching.value = false;
  }
}

/** 検索オプションの1項目を反転させ、即座に（現在のqueryで）再検索する */
function toggleOption(key: keyof TextSearchOptions): void {
  options.value = { ...options.value, [key]: !options.value[key] };
  void runSearch();
}

function containerNameOf(cId: ContainerID): string {
  return containers.value.find((c) => c.id === cId)?.name ?? cId;
}

/** 検索結果をクリックした際、該当文書の該当ページをタブで開く */
function openResult(file: ContainerElementFile, pageNumber: number): void {
  editorStore.openTab(file, pageNumber);
}

onMounted(async () => {
  const res = await api.getAllContainers();
  if (res.ok) containers.value = res.data;
});
</script>

<style lang="scss" scoped>
.search-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.search-view-header {
  display: flex;
  align-items: center;
}

.search-view-options {
  display: flex;
  justify-content: flex-end;
  gap: 2px;
}

.search-view-option-btn {
  font-size: 11px;
  font-weight: 700;
  width: 28px;
}

.search-view-option-btn--active {
  color: $primary;
  background: rgba($primary, 0.12);
}

.search-view-results {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
}

.search-view-file-header {
  font-weight: 500;
  word-break: break-all;
}
</style>
