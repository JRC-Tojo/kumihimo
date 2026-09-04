<template>
  <!-- 文書内テキスト検索（Ctrl+F）バー。issue #33の要件1（文書内検索）に対応する。
       ハイライト・スクロール自体は親（DocumentTabView.vue）がactiveMatch/matchesをPdfPageへ渡して
       行うため、ここでは検索クエリの入力・検索オプション・ナビゲーションUIに徹する。
       コンテナ横断検索は左サイドパネルの検索タブ（SearchView.vue）に分離されている -->
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

      <!-- 検索オプション（大文字小文字・半角全角・正規表現）: VSCodeの検索ウィジェットに倣い、
           トグルボタンで切り替える。切り替えるとすぐに現在のクエリで再検索される -->
      <div class="search-bar__options-row">
        <q-btn
          flat
          dense
          round
          size="sm"
          label="Aa"
          class="search-bar__option-btn"
          :class="{ 'search-bar__option-btn--active': options.caseSensitive }"
          :title="$t('pdfEditor.search.matchCase')"
          @click="toggleOption('caseSensitive')"
        />
        <q-btn
          flat
          dense
          round
          size="sm"
          label="全/半"
          class="search-bar__option-btn"
          :class="{ 'search-bar__option-btn--active': options.ignoreWidth }"
          :title="$t('pdfEditor.search.ignoreWidth')"
          @click="toggleOption('ignoreWidth')"
        />
        <q-btn
          flat
          dense
          round
          size="sm"
          label=".*"
          class="search-bar__option-btn"
          :class="{ 'search-bar__option-btn--active': options.useRegex }"
          :title="$t('pdfEditor.search.useRegex')"
          @click="toggleOption('useRegex')"
        />
      </div>
    </q-card>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { TextSearchOptions } from 'src/models/document/search';

interface Props {
  /** 検索クエリ（v-model） */
  query: string;
  /** 検索オプション（大文字小文字・半角全角・正規表現、v-model） */
  options: TextSearchOptions;
  matchCount: number;
  /** 現在アクティブなマッチの0始まりインデックス（表示用。matchCountが0の場合は無視される） */
  activeIndex: number;
  isSearching: boolean;
}
const props = defineProps<Props>();
const emit = defineEmits<{
  'update:query': [value: string];
  'update:options': [value: TextSearchOptions];
  next: [];
  previous: [];
  close: [];
}>();

const { t } = useI18n();

const inputRef = ref<HTMLInputElement | null>(null);
onMounted(() => {
  // 検索バーが開いた瞬間、即座に入力できるようフォーカスする
  void nextTick(() => inputRef.value?.focus());
});

function onInput(e: Event): void {
  emit('update:query', (e.target as HTMLInputElement).value);
}

/** 検索オプションの1項目を反転させて emit する */
function toggleOption(key: keyof TextSearchOptions): void {
  emit('update:options', { ...props.options, [key]: !props.options[key] });
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

.search-bar__options-row {
  display: flex;
  justify-content: flex-end;
  gap: 2px;
  padding-top: 2px;
}

.search-bar__option-btn {
  font-size: 11px;
  font-weight: 700;
  width: 28px;
}

.search-bar__option-btn--active {
  color: $primary;
  background: rgba($primary, 0.12);
}
</style>
