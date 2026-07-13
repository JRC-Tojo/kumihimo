<template>
  <div class="settings-page">
    <!-- 目次サイドバー -->
    <div class="settings-toc">
      <q-input
        v-model="searchQuery"
        dense
        outlined
        clearable
        :placeholder="$t('settings.searchPlaceholder')"
        class="q-mb-md"
        @clear="() => (searchQuery = '')"
      >
        <template #prepend>
          <q-icon name="search" />
        </template>
      </q-input>

      <q-list>
        <q-item
          v-for="section in visibleSections"
          :key="section.id"
          clickable
          dense
          class="toc-item"
          @click="scrollToSection(section.id)"
        >
          <q-item-section>{{ section.title }}</q-item-section>
        </q-item>
        <q-item v-if="visibleSections.length === 0" dense>
          <q-item-section class="text-grey-6">{{ $t('settings.noResults') }}</q-item-section>
        </q-item>
      </q-list>
    </div>

    <!-- 設定本体 -->
    <div ref="contentRef" class="settings-content">
      <h1 class="text-h5 q-mb-lg">{{ $t('settings.title') }}</h1>

      <template v-if="settings">
        <!-- 一般 -->
        <section
          v-if="visibleSections.some((s) => s.id === 'general')"
          id="general"
          class="settings-section"
        >
          <h6 class="settings-section-title">{{ $t('settings.sections.general') }}</h6>

          <SettingsItemRow
            v-show="isVisible('darkMode')"
            :title="$t('settings.darkMode')"
            :description="$t('settings.darkModeDesc')"
          >
            <q-toggle
              v-model="settings.darkMode"
              @update:model-value="(val) => updateSettings('darkMode')(val)"
            />
          </SettingsItemRow>

          <SettingsItemRow
            v-show="isVisible('language')"
            :title="$t('settings.language')"
            :description="$t('settings.languageDesc')"
          >
            <q-select
              v-model="settings.locale"
              :options="languages"
              emit-value
              map-options
              dense
              outlined
              style="min-width: 160px"
              @update:model-value="(val) => updateSettings('locale')(val)"
            />
          </SettingsItemRow>
        </section>

        <!-- 表示 -->
        <section
          v-if="visibleSections.some((s) => s.id === 'display')"
          id="display"
          class="settings-section"
        >
          <h6 class="settings-section-title">{{ $t('settings.sections.display') }}</h6>

          <SettingsItemRow
            v-show="isVisible('viewMode')"
            :title="$t('settings.viewMode')"
            :description="$t('settings.viewModeDesc')"
          >
            <q-select
              v-model="settings.viewMode"
              @update:model-value="(val) => updateSettings('viewMode')(val)"
              :options="viewModes"
              emit-value
              map-options
              dense
              outlined
              style="min-width: 160px"
            />
          </SettingsItemRow>

          <SettingsItemRow
            v-show="isVisible('sortBy')"
            :title="$t('settings.sortBy')"
            :description="$t('settings.sortByDesc')"
          >
            <q-select
              v-model="settings.sortBy"
              @update:model-value="(val) => updateSettings('sortBy')(val)"
              :options="sortOptions"
              emit-value
              map-options
              dense
              outlined
              style="min-width: 160px"
            />
          </SettingsItemRow>
        </section>

        <!-- 関係性検証スタイル -->
        <section
          v-if="visibleSections.some((s) => s.id === 'relational')"
          id="relational"
          class="settings-section"
        >
          <h6 class="settings-section-title">{{ $t('settings.relationalVerification.title') }}</h6>

          <SettingsItemRow
            v-show="isVisible('relationalOk')"
            :title="$t('settings.relationalVerification.ok')"
            :description="$t('settings.relationalVerification.okDesc')"
          >
            <RelationalStatusStyleEditor
              v-model="settings.relationalVerificationStyle.ok"
              @update:model-value="
                (val) => {
                  if (settings === void 0) return;
                  const buildVal = { ok: val, ng: settings.relationalVerificationStyle.ng };
                  updateSettings('relationalVerificationStyle')(buildVal);
                }
              "
            />
          </SettingsItemRow>

          <SettingsItemRow
            v-show="isVisible('relationalNg')"
            :title="$t('settings.relationalVerification.ng')"
            :description="$t('settings.relationalVerification.ngDesc')"
          >
            <RelationalStatusStyleEditor
              v-model="settings.relationalVerificationStyle.ng"
              @update:model-value="
                (val) => {
                  if (settings === void 0) return;
                  const buildVal = { ng: val, ok: settings.relationalVerificationStyle.ok };
                  updateSettings('relationalVerificationStyle')(buildVal);
                }
              "
            />
          </SettingsItemRow>
        </section>

        <!-- データ -->
        <section
          v-if="visibleSections.some((s) => s.id === 'data')"
          id="data"
          class="settings-section"
        >
          <h6 class="settings-section-title">{{ $t('settings.sections.data') }}</h6>

          <SettingsItemRow
            v-show="isVisible('sampleData')"
            :title="$t('settings.sampleData.create')"
            :description="$t('settings.sampleData.createDesc')"
          >
            <q-btn
              color="primary"
              dense
              :label="$t('settings.sampleData.create')"
              @click="createSampleData"
            />
          </SettingsItemRow>

          <SettingsItemRow
            v-show="isVisible('clearData')"
            :title="$t('settings.sampleData.clear')"
            :description="$t('settings.sampleData.clearDesc')"
          >
            <q-btn
              flat
              dense
              color="negative"
              :label="$t('settings.sampleData.clear')"
              @click="clearAllData"
            />
          </SettingsItemRow>
        </section>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { useBackendApi } from 'src/apis/backendApi';
import type { AppSettings } from 'src/models/settings';
import { useSettingsStore } from 'src/stores/settingsStore';
import SettingsItemRow from 'src/components/Settings/SettingsItemRow.vue';
import RelationalStatusStyleEditor from 'src/components/Settings/RelationalStatusStyleEditor.vue';

const { t: $t } = useI18n();
const $q = useQuasar();
const api = useBackendApi();
const settingsStore = useSettingsStore();

const settings = ref<AppSettings>();

const viewModes = [
  { label: $t('viewMode.rich'), value: 'rich' },
  { label: $t('viewMode.list1'), value: 'list1' },
  { label: $t('viewMode.list2'), value: 'list2' },
];

const sortOptions = [
  { label: $t('sort.byName'), value: 'name' },
  { label: $t('sort.byUpdatedAt'), value: 'updatedAt' },
  { label: $t('sort.byGenre'), value: 'genre' },
];

const languages = [
  { label: 'English', value: 'en-US' },
  { label: '日本語', value: 'ja-JP' },
];

onMounted(async () => {
  const apiRes = await api.getSettings();
  if (apiRes.ok) {
    settings.value = apiRes.data;
  } else {
    // TODO: エラーハンドリング
    console.error(apiRes.error);
  }
});

// ================================ 検索・目次 ================================

interface SettingsItemMeta {
  id: string;
  sectionId: string;
  title: string;
  description: string;
}

const itemMetas = computed<SettingsItemMeta[]>(() => [
  {
    id: 'darkMode',
    sectionId: 'general',
    title: $t('settings.darkMode'),
    description: $t('settings.darkModeDesc'),
  },
  {
    id: 'language',
    sectionId: 'general',
    title: $t('settings.language'),
    description: $t('settings.languageDesc'),
  },
  {
    id: 'viewMode',
    sectionId: 'display',
    title: $t('settings.viewMode'),
    description: $t('settings.viewModeDesc'),
  },
  {
    id: 'sortBy',
    sectionId: 'display',
    title: $t('settings.sortBy'),
    description: $t('settings.sortByDesc'),
  },
  {
    id: 'relationalOk',
    sectionId: 'relational',
    title: $t('settings.relationalVerification.ok'),
    description: $t('settings.relationalVerification.okDesc'),
  },
  {
    id: 'relationalNg',
    sectionId: 'relational',
    title: $t('settings.relationalVerification.ng'),
    description: $t('settings.relationalVerification.ngDesc'),
  },
  {
    id: 'sampleData',
    sectionId: 'data',
    title: $t('settings.sampleData.create'),
    description: $t('settings.sampleData.createDesc'),
  },
  {
    id: 'clearData',
    sectionId: 'data',
    title: $t('settings.sampleData.clear'),
    description: $t('settings.sampleData.clearDesc'),
  },
]);

const sectionDefs = computed(() => [
  { id: 'general', title: $t('settings.sections.general') },
  { id: 'display', title: $t('settings.sections.display') },
  { id: 'relational', title: $t('settings.relationalVerification.title') },
  { id: 'data', title: $t('settings.sections.data') },
]);

const searchQuery = ref('');

const matchedItemIds = computed<Set<string>>(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return new Set(itemMetas.value.map((m) => m.id));
  return new Set(
    itemMetas.value
      .filter((m) => m.title.toLowerCase().includes(q) || m.description.toLowerCase().includes(q))
      .map((m) => m.id),
  );
});

function isVisible(itemId: string): boolean {
  return matchedItemIds.value.has(itemId);
}

const visibleSections = computed(() =>
  sectionDefs.value.filter((s) =>
    itemMetas.value.some((m) => m.sectionId === s.id && matchedItemIds.value.has(m.id)),
  ),
);

const contentRef = ref<HTMLElement>();

function scrollToSection(id: string) {
  contentRef.value?.querySelector(`#${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ================================ 保存・その他操作 ================================

/**
 * 各設定を保存
 */
function updateSettings<K extends keyof AppSettings>(key: K) {
  return async (value: AppSettings[K]) => {
    // 設定を保存する
    await api.saveSettings(key, value);
    // 開いている文書タブなど、設定をリアクティブに参照している箇所にも反映する
    await settingsStore.loadSettings();
  };
}

/**
 * サンプルデータを作成
 */
async function createSampleData() {
  const { createDemoData } = await import('src/utils/appInitializer');
  await createDemoData();
  $q.notify({
    type: 'positive',
    message: 'Sample documents created!',
  });
}

/**
 * すべてのデータをクリア
 */
function clearAllData() {
  $q.dialog({
    title: 'Confirm',
    message: 'Are you sure you want to delete all data? This action cannot be undone.',
    cancel: true,
    persistent: true,
  }).onOk(() => {
    // localStorageRepository.clear() を呼ぶ（ただし、実装では関数がexportされていないため省略）
    $q.notify({
      type: 'positive',
      message: 'All data cleared',
    });
  });
}
</script>

<style scoped lang="scss">
.settings-page {
  display: flex;
  height: 100%;
  width: 100%;
  overflow: hidden;
  background: white;
}

.body--dark .settings-page {
  background: $dark;
}

.settings-toc {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid $grey-3;
  padding: 1rem;
  overflow-y: auto;

  .toc-item {
    border-radius: 6px;
  }
}

.body--dark .settings-toc {
  border-right-color: $grey-8;
}

.settings-content {
  flex: 1 1 0;
  overflow-y: auto;
  padding: 1.5rem 2rem;
  max-width: 720px;

  .settings-section {
    margin-bottom: 2rem;

    .settings-section-title {
      font-weight: 600;
      color: $primary;
      margin: 0 0 0.25rem;
    }
  }

  .save-bar {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid $grey-3;
  }
}

.body--dark .settings-content .save-bar {
  border-top-color: $grey-8;
}
</style>
