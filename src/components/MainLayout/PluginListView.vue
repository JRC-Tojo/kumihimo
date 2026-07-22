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

    <q-tabs v-model="subTab" dense class="plugin-sub-tabs">
      <q-tab name="installed" :label="$t('plugins.tabs.installed')" />
      <q-tab name="catalog" :label="$t('plugins.tabs.catalog')" />
      <q-tab name="submissions" :label="$t('plugins.tabs.submissions')" />
    </q-tabs>
    <q-separator />

    <q-tab-panels v-model="subTab" class="plugin-sub-panels">
      <q-tab-panel name="installed" class="q-pa-none">
        <div v-if="pluginStore.installed.length === 0" class="text-grey-6 text-caption q-pa-sm">
          {{ $t('plugins.list.noInstalled') }}
        </div>
        <q-list separator>
          <PluginListItem
            v-for="entry in pluginStore.installed"
            :key="entry.manifest.id"
            :manifest="entry.manifest"
            :installed="true"
            @run="onRun(entry.manifest)"
            @uninstall="onUninstall(entry.manifest.id)"
            @details="onDetails(entry.manifest)"
          />
        </q-list>
      </q-tab-panel>

      <q-tab-panel name="catalog" class="q-pa-none">
        <div v-if="pluginStore.catalog.length === 0" class="text-grey-6 text-caption q-pa-sm">
          {{ $t('plugins.list.noCatalogEntries') }}
        </div>
        <q-list separator>
          <PluginListItem
            v-for="entry in pluginStore.catalog"
            :key="entry.manifest.id"
            :manifest="entry.manifest"
            :installed="isInstalled(entry.manifest.id)"
            @install="onInstall(entry.manifest.id)"
            @details="onDetails(entry.manifest)"
          />
        </q-list>
      </q-tab-panel>

      <q-tab-panel name="submissions" class="q-pa-none">
        <q-list separator>
          <PluginSubmissionItem
            v-for="submission in pluginStore.submissions"
            :key="submission.id"
            :submission="submission"
            @publish="onPublish(submission.id)"
          />
        </q-list>
      </q-tab-panel>
    </q-tab-panels>

    <PluginDetailsDialog v-model="showDetailsDialog" :manifest="detailsManifest" />
    <SubmitPluginDialog v-model="showSubmitDialog" @submitted="onSubmitted" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePluginStore } from 'src/stores/pluginStore';
import { useBackendApi } from 'src/apis/backendApi';
import type { PluginID, PluginManifest } from 'src/models/plugin/manifest';
import type { PluginSubmissionID } from 'src/models/plugin/submission';
import PluginListItem from './Plugin/PluginListItem.vue';
import PluginDetailsDialog from './Plugin/PluginDetailsDialog.vue';
import PluginSubmissionItem from './Plugin/PluginSubmissionItem.vue';
import SubmitPluginDialog from './Plugin/SubmitPluginDialog.vue';
import { usePluginRun } from './Plugin/usePluginRun';

const { t: $t } = useI18n();
const api = useBackendApi();
const pluginStore = usePluginStore();
const { runPlugin } = usePluginRun();

const subTab = ref<'installed' | 'catalog' | 'submissions'>('installed');
const showDetailsDialog = ref(false);
const showSubmitDialog = ref(false);
const detailsManifest = ref<PluginManifest>();

function isInstalled(id: PluginID): boolean {
  return pluginStore.installed.some((entry) => entry.manifest.id === id);
}

async function refreshAll() {
  await Promise.all([
    pluginStore.loadInstalled(),
    pluginStore.loadCatalog(),
    pluginStore.loadSubmissions(),
  ]);
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

async function onRun(manifest: PluginManifest) {
  await runPlugin(manifest);
}

async function onPublish(id: PluginSubmissionID) {
  await api.republishPluginSubmission(id);
  await pluginStore.loadSubmissions();
}

async function onSubmitted() {
  await pluginStore.loadSubmissions();
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

.plugin-sub-panels {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
}
</style>
