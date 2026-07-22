<template>
  <div class="plugin-list-view">
    <div class="plugin-list-view-header q-pa-sm">
      <div class="text-subtitle2">{{ $t('plugins.title') }}</div>
      <q-space />
      <q-btn flat dense round icon="refresh" size="sm" @click="refreshAll">
        <q-tooltip>{{ $t('plugins.actions.refresh') }}</q-tooltip>
      </q-btn>
      <q-btn flat dense round icon="upload" size="sm" @click="showSubmitDialog = true">
        <q-tooltip>{{ $t('plugins.actions.submitNew') }}</q-tooltip>
      </q-btn>
    </div>

    <div class="q-px-sm q-pb-sm">
      <q-input
        v-model="searchQuery"
        dense
        outlined
        clearable
        :placeholder="$t('plugins.list.searchPlaceholder')"
      >
        <template #prepend>
          <q-icon name="search" />
        </template>
      </q-input>
    </div>

    <q-separator />

    <div class="plugin-list-sections">
      <q-expansion-item
        v-model="installedExpanded"
        dense-toggle
        default-opened
        :label="$t('plugins.list.installedSection')"
        header-class="plugin-section-header"
      >
        <div v-if="filteredInstalled.length === 0" class="text-grey-6 text-caption q-pa-sm">
          {{ $t('plugins.list.noInstalled') }}
        </div>
        <q-list separator>
          <PluginListItem
            v-for="entry in filteredInstalled"
            :key="entry.manifest.id"
            :manifest="entry.manifest"
            :installed="true"
            :icon-src="entry.iconDataUrl"
            @run="onRun(entry.manifest)"
            @uninstall="onUninstall(entry.manifest.id)"
            @details="onDetails(entry.manifest)"
          />
        </q-list>
      </q-expansion-item>

      <q-separator />

      <q-expansion-item
        v-model="catalogExpanded"
        dense-toggle
        default-opened
        :label="$t('plugins.list.catalogSection')"
        header-class="plugin-section-header"
      >
        <div v-if="filteredCatalog.length === 0" class="text-grey-6 text-caption q-pa-sm">
          {{ $t('plugins.list.noCatalogEntries') }}
        </div>
        <q-list separator>
          <PluginListItem
            v-for="entry in filteredCatalog"
            :key="entry.manifest.id"
            :manifest="entry.manifest"
            :installed="isInstalled(entry.manifest.id)"
            :icon-src="entry.iconUrl"
            @install="onInstall(entry.manifest.id)"
            @details="onDetails(entry.manifest)"
          />
        </q-list>
      </q-expansion-item>
    </div>

    <PluginDetailsDialog v-model="showDetailsDialog" :manifest="detailsManifest" />
    <SubmitPluginDialog v-model="showSubmitDialog" @submitted="onSubmitted" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePluginStore } from 'src/stores/pluginStore';
import { useEditorStore } from 'src/stores/editorStore';
import type { PluginID, PluginManifest } from 'src/models/plugin/manifest';
import PluginListItem from './Plugin/PluginListItem.vue';
import PluginDetailsDialog from './Plugin/PluginDetailsDialog.vue';
import SubmitPluginDialog from './Plugin/SubmitPluginDialog.vue';

const { t: $t } = useI18n();
const pluginStore = usePluginStore();
const editorStore = useEditorStore();

const showDetailsDialog = ref(false);
const showSubmitDialog = ref(false);
const detailsManifest = ref<PluginManifest>();
const searchQuery = ref('');
const installedExpanded = ref(true);
const catalogExpanded = ref(true);

function matchesQuery(manifest: PluginManifest, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return manifest.name.toLowerCase().includes(q) || manifest.description.toLowerCase().includes(q);
}

const filteredInstalled = computed(() =>
  pluginStore.installed.filter((entry) => matchesQuery(entry.manifest, searchQuery.value)),
);
const filteredCatalog = computed(() =>
  pluginStore.catalog.filter(
    (entry) => !entry.manifest.deprecated && matchesQuery(entry.manifest, searchQuery.value),
  ),
);

function isInstalled(id: PluginID): boolean {
  return pluginStore.installed.some((entry) => entry.manifest.id === id);
}

async function refreshAll() {
  await Promise.all([pluginStore.loadInstalled(), pluginStore.loadCatalog()]);
}

async function onInstall(id: PluginID) {
  await pluginStore.install(id);
}

async function onUninstall(id: PluginID) {
  await pluginStore.uninstall(id);
}

function onDetails(manifest: PluginManifest) {
  detailsManifest.value = manifest;
  showDetailsDialog.value = true;
}

/**
 * 実行ボタン押下時：プラグイン専用タブを開くだけでよい（入力フォーム・実行操作は
 * タブ内（PluginPanelView）に統合されている）
 */
function onRun(manifest: PluginManifest) {
  editorStore.openPluginTab(manifest.id, manifest.name);
}

async function onSubmitted() {
  await pluginStore.loadCatalog();
}

onMounted(refreshAll);
</script>

<style lang="scss" scoped>
.plugin-list-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.plugin-list-view-header {
  display: flex;
  align-items: center;
}

.plugin-list-sections {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
}

.plugin-section-header {
  font-weight: 500;
}
</style>
