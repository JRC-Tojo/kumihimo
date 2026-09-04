<template>
  <!-- 検索オプション（大文字小文字・半角全角・正規表現）のトグルボタン群。
       文書内検索（SearchBar.vue）とコンテナ横断検索（SearchView.vue）で共通のUIとして使う。
       「押している状態＝ラベルが示す動作（大文字小文字を区別する等）が有効」という向きに統一し、
       押している間は四角形のアウトラインにPrimaryカラーを適用する -->
  <div class="search-option-toggles">
    <q-btn
      v-for="opt in OPTION_DEFS"
      :key="opt.key"
      dense
      square
      flat
      no-caps
      size="sm"
      :label="opt.label"
      class="search-option-toggles__btn"
      :class="{ 'search-option-toggles__btn--active': options[opt.key] }"
      :title="t(opt.titleKey)"
      @click="toggle(opt.key)"
    />
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { TextSearchOptions } from 'src/models/document/search';

interface Props {
  /** 検索オプション（v-model） */
  options: TextSearchOptions;
}
const props = defineProps<Props>();
const emit = defineEmits<{
  'update:options': [value: TextSearchOptions];
}>();

const { t } = useI18n();

/** ボタンのラベル・ツールチップ・対象オプションキーの定義（表示順） */
const OPTION_DEFS = [
  { key: 'caseSensitive', label: 'Aa', titleKey: 'pdfEditor.search.matchCase' },
  { key: 'distinguishWidth', label: '全角/半角', titleKey: 'pdfEditor.search.distinguishWidth' },
  { key: 'useRegex', label: '.*', titleKey: 'pdfEditor.search.useRegex' },
] as const satisfies ReadonlyArray<{
  key: keyof TextSearchOptions;
  label: string;
  titleKey: string;
}>;

/** 検索オプションの1項目を反転させて emit する */
function toggle(key: keyof TextSearchOptions): void {
  emit('update:options', { ...props.options, [key]: !props.options[key] });
}
</script>

<style scoped lang="scss">
.search-option-toggles {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
}

// Quasarのoutlineボタン（`.q-btn--outline`）は背景を`background: transparent !important`で
// 固定しており、押した状態の塗りつぶしを乗せられない。またダークモード共通スタイル
// （app.scssの`.body--dark .q-btn--outline`）がボーダー色をグレー固定するため、
// アクティブ時にPrimaryカラーへ確実に切り替えられるよう、outlineプロパティは使わず
// 自前のボーダーで四角形のアウトラインスタイルを再現する
.search-option-toggles__btn {
  font-size: 11px;
  font-weight: 700;
  min-width: 28px;
  padding: 0 6px;
  border: 1px solid rgba(0, 0, 0, 0.24);
}

.body--dark .search-option-toggles__btn {
  border-color: rgba(255, 255, 255, 0.28);
}

// `.search-option-toggles`まで含めた分だけ、直上の`.body--dark .search-option-toggles__btn`
// （ボーダー色のダークモード用既定値）より詳細度を上げ、アクティブ時は確実にPrimaryカラーを勝たせる
.search-option-toggles .search-option-toggles__btn--active {
  color: var(--q-primary);
  border-color: var(--q-primary);
  background: rgba(var(--q-primary-rgb), 0.12);
}
</style>
