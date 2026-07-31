<template>
  <div class="settings-page">
    <!-- 目次サイドバー -->
    <div class="settings-toc">
      <q-input
        v-model="searchQuery"
        dense
        outlined
        clearable
        :placeholder="$t('containerSettings.searchPlaceholder')"
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
          <q-item-section class="text-grey-6">{{
            $t('containerSettings.noResults')
          }}</q-item-section>
        </q-item>
      </q-list>
    </div>

    <!-- 設定本体 -->
    <div ref="contentRef" class="settings-content">
      <h1 class="text-h5 q-mb-lg">
        {{ $t('containerSettings.title') }}
        <span class="text-grey-6 text-h6">— {{ prop.containerName }}</span>
      </h1>

      <template v-if="relaxation !== undefined">
        <!-- 関係性 -->
        <section
          v-if="visibleSections.some((s) => s.id === 'relational')"
          id="relational"
          class="settings-section"
        >
          <h6 class="settings-section-title">
            {{ $t('containerSettings.sections.relational') }}
          </h6>

          <SettingsItemRow
            v-show="isVisible('relationalRelaxation')"
            :title="$t('settings.relationalRelaxation.title')"
            :description="$t('settings.relationalRelaxation.description')"
          >
            <RelaxationRuleEditor v-model="relaxation" @update:model-value="onSaveRelaxation" />
          </SettingsItemRow>
        </section>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * コンテナ単位の設定タブ
 *
 * `.kumihimo/settings.json`（コンテナルート）に保存される、コンテナ単位の設定を編集する。
 * ブラウザ単位のアプリ設定（`SettingsPage.vue`）と見た目・操作感を統一するため、目次・検索・
 * セクション構成の骨格をそのまま踏襲している（今後コンテナ設定項目が増えても同じ形で追加できる）
 */
import { computed, nextTick, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { useBackendApi } from 'src/apis/backendApi';
import type { ContainerID } from 'src/models/container';
import type { RelaxationOptions } from 'src/models/relational/relaxation';
import { sanitizeRelaxationOptions } from 'src/utils/text/relaxedCompare';
import SettingsItemRow from 'src/components/Settings/SettingsItemRow.vue';
import RelaxationRuleEditor from 'src/components/Settings/RelaxationRuleEditor.vue';

interface Prop {
  containerId: ContainerID;
  containerName: string;
}
const prop = defineProps<Prop>();

const { t: $t } = useI18n();
const $q = useQuasar();
const api = useBackendApi();

const relaxation = ref<RelaxationOptions>();

onMounted(async () => {
  const res = await api.getContainerRelaxationSettings(prop.containerId);
  if (res.ok) {
    relaxation.value = res.data;
  } else {
    // TODO: エラーハンドリング
    console.error(res.error);
  }
});

/**
 * 緩和ルールを保存する。失敗した場合は通知のみ行い、画面上の内容は保持する
 */
async function onSaveRelaxation(value: RelaxationOptions) {
  const res = await api.saveContainerRelaxationSettings(
    prop.containerId,
    sanitizeRelaxationOptions(value),
  );
  if (!res.ok) {
    $q.notify({ type: 'negative', message: $t('containerSettings.saveFailed') });
  }
}

// ================================ 検索・目次 ================================

interface ContainerSettingsItemMeta {
  id: string;
  sectionId: string;
  title: string;
  description: string;
}

const itemMetas = computed<ContainerSettingsItemMeta[]>(() => [
  {
    id: 'relationalRelaxation',
    sectionId: 'relational',
    title: $t('settings.relationalRelaxation.title'),
    description: $t('settings.relationalRelaxation.description'),
  },
]);

const sectionDefs = computed(() => [
  { id: 'relational', title: $t('containerSettings.sections.relational') },
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

/** 指定IDのセクション要素までスムーズスクロールする */
function scrollToSection(id: string): void {
  void nextTick(() => {
    contentRef.value
      ?.querySelector(`#${id}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
}
</style>
