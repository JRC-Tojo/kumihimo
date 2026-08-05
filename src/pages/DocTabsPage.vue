<template>
  <div class="doc-tabs-page">
    <!-- タブバー -->
    <div class="tabs-bar">
      <!-- 設定タブ（開いている場合のみ、文書タブの前に固定表示） -->
      <TabItem
        v-if="editorStore.settingsOpenSides[prop.layoutSide]"
        icon="settings"
        :title="$t('settings.title')"
        :active="isSettingsActive"
        @select="selectSettingsTab"
        @close="editorStore.closeSettingsTab(prop.layoutSide)"
      />

      <!-- プラグイン所有タブ（開いている場合のみ、文書タブの前に固定表示） -->
      <TabItem
        v-for="pt in editorStore.pluginTabs[prop.layoutSide]"
        :key="pt.key"
        icon="extension"
        :title="pt.title"
        :active="editorStore.activeTabPaths[prop.layoutSide] === pt.key"
        @select="selectPluginTab(pt.key)"
        @close="editorStore.closePluginTab(pt.key, prop.layoutSide)"
      />

      <!-- コンテナ設定タブ（開いている場合のみ、文書タブの前に固定表示） -->
      <TabItem
        v-for="ct in editorStore.containerSettingsTabs[prop.layoutSide]"
        :key="ct.key"
        icon="settings"
        :title="ct.title"
        :active="editorStore.activeTabPaths[prop.layoutSide] === ct.key"
        @select="selectContainerSettingsTab(ct.key)"
        @close="editorStore.closeContainerSettingsTab(ct.key, prop.layoutSide)"
      />

      <VueDraggable
        v-model="tabs"
        :animation="0"
        group="documentTabs"
        class="tabs-container"
        @add="onTabAdded"
        @remove="onTabRemoved"
      >
        <!-- タブを並べる -->
        <DocTabItem
          v-for="tab in tabs"
          :key="`${tab.containerID}/${tab.path}`"
          :file="tab"
          :active="
            !isSettingsActive && isSameFile(tab, activeTabFile) && activeLayout === layoutSide
          "
          @select="selectTab(tab, true)"
          @close="closeTab(tab)"
        />
      </VueDraggable>
    </div>

    <!-- コンテンツエリア -->
    <div class="tabs-content">
      <SettingsPage v-if="isSettingsActive" />
      <PluginPanelView
        v-else-if="activePluginTab"
        :plugin-id="activePluginTab.pluginId"
        :source="activePluginTab.source"
        :key="`plugin|${activePluginTab.key}`"
      />
      <ContainerSettingsPage
        v-else-if="activeContainerSettingsTab"
        :container-id="activeContainerSettingsTab.containerID"
        :container-name="activeContainerSettingsTab.title"
        :key="`containerSettings|${activeContainerSettingsTab.key}`"
      />
      <DocumentTabView
        v-else-if="activeTabFile && activeDocumentKind === 'pdf'"
        :file="activeTabFile"
        :layout-side="prop.layoutSide"
        :key="`pdf|${activeTabFile.containerID}|${activeTabFile.path}`"
      />
      <TextFileTabView
        v-else-if="activeTabFile && activeDocumentKind === 'text'"
        :file="activeTabFile"
        :key="`text|${activeTabFile.containerID}|${activeTabFile.path}`"
      />
      <UnsupportedFileTabView
        v-else-if="activeTabFile"
        :file="activeTabFile"
        :key="`unsupported|${activeTabFile.containerID}|${activeTabFile.path}`"
      />
      <div v-else class="empty-state">
        <q-icon name="description" size="3rem" color="grey-5" />
        <p class="q-mt-md text-grey-6">{{ $t('pdfEditor.document.noDocumentSelected') }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import DocumentTabView from 'src/components/DocLayout/DocumentTabView.vue';
import TextFileTabView from 'src/components/DocLayout/TextFileTabView.vue';
import UnsupportedFileTabView from 'src/components/DocLayout/UnsupportedFileTabView.vue';
import PluginPanelView from 'src/components/DocLayout/PluginPanelView.vue';
import DocTabItem from 'src/components/DocLayout/DocTabItem.vue';
import TabItem from 'src/components/DocLayout/TabItem.vue';
import SettingsPage from 'src/pages/SettingsPage.vue';
import ContainerSettingsPage from 'src/pages/ContainerSettingsPage.vue';
import type { ContainerElementFile } from 'src/models/container';
import { useEditorStore, SETTINGS_TAB_KEY } from 'src/stores/editorStore';
import type { LayoutSide } from 'src/stores/editorStore';
import { getSupportedDocumentKind } from 'src/utils/document/supportedTypes';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { DraggableEvent } from 'vue-draggable-plus';
import { VueDraggable } from 'vue-draggable-plus';
import { useBackendApi } from 'src/apis/backendApi';
import { Path } from 'src/utils/binary/path';
import { saveDocument } from 'src/utils/document/saveDocument';
import { unsavedChangesDialog } from 'src/components/Dialog/confirmDialog';

interface Prop {
  layoutSide: LayoutSide;
}
const prop = defineProps<Prop>();

const { t: $t } = useI18n();
const api = useBackendApi();
const editorStore = useEditorStore();
const tabs = computed({
  get: () => editorStore.tabs[prop.layoutSide],
  set: (newTabList) => {
    editorStore.tabs[prop.layoutSide] = newTabList;
  },
});
const activeTabFile = computed(() => editorStore.getActiveTab(prop.layoutSide));
const activeDocumentKind = computed(() =>
  activeTabFile.value ? getSupportedDocumentKind(activeTabFile.value.path) : undefined,
);
const activeLayout = computed(() => editorStore.activeSide);
const isSettingsActive = computed(
  () => editorStore.activeTabPaths[prop.layoutSide] === SETTINGS_TAB_KEY,
);
const activePluginTab = computed(() =>
  editorStore.pluginTabs[prop.layoutSide].find(
    (pt) => pt.key === editorStore.activeTabPaths[prop.layoutSide],
  ),
);
const activeContainerSettingsTab = computed(() =>
  editorStore.containerSettingsTabs[prop.layoutSide].find(
    (ct) => ct.key === editorStore.activeTabPaths[prop.layoutSide],
  ),
);

function selectSettingsTab() {
  editorStore.selectSettingsTab(prop.layoutSide, true);
}

function selectPluginTab(key: string) {
  editorStore.selectPluginTab(key, prop.layoutSide, true);
}

/**
 * コンテナ設定タブを選択状態にする
 */
function selectContainerSettingsTab(key: string) {
  editorStore.selectContainerSettingsTab(key, prop.layoutSide, true);
}

/**
 * 同一ファイルかどうかをcontainerID込みで判定する（別コンテナの同名パスファイルを区別するため）
 */
function isSameFile(a: ContainerElementFile, b: ContainerElementFile | null | undefined): boolean {
  return b !== null && b !== undefined && a.containerID === b.containerID && a.path === b.path;
}

function selectTab(file: ContainerElementFile, isFocus: boolean) {
  editorStore.selectTab(file, prop.layoutSide, isFocus);
}

async function closeTab(file: ContainerElementFile) {
  const unsavedRes = await api.hasUnsavedChangesByFile(file);
  const hasUnsavedChanges = unsavedRes.ok && unsavedRes.data;

  if (hasUnsavedChanges) {
    const choice = await unsavedChangesDialog({
      title: $t('explorer.unsavedChanges'),
      message: $t('explorer.unsavedTabConfirm', { name: new Path(file.path).basename() }),
    });
    if (choice === 'cancel') return;
    if (choice === 'save') {
      await saveDocument(file);
    } else {
      // 保存せず閉じる：仮登録されたアノテーション・関係性を破棄し、保存前の状態へ巻き戻す
      await api.discardUnsavedChanges(file);
    }
  }

  editorStore.closeTab(file, prop.layoutSide);
}

function onTabAdded(e: DraggableEvent<ContainerElementFile>) {
  const tabFile = tabs.value[e.newIndex ?? 0];
  if (tabFile !== void 0) selectTab(tabFile, true);
}

function onTabRemoved(e: DraggableEvent<ContainerElementFile>) {
  const targetIdx = Math.max(0, (e.oldIndex ?? 0) - 1);
  const tabFile = tabs.value[targetIdx];
  if (tabFile !== void 0) selectTab(tabFile, false);
}
</script>

<style scoped lang="scss">
.doc-tabs-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: $grey-1;
  overflow: hidden;
}

.tabs-bar {
  display: flex;
  align-items: center;
  background: white;
  border-bottom: 2px solid var(--q-primary);
  overflow-x: auto;
  overflow-y: hidden;
  height: 48px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);

  &::-webkit-scrollbar {
    height: 4px;
  }

  &::-webkit-scrollbar-track {
    background: $grey-2;
  }

  &::-webkit-scrollbar-thumb {
    background: $grey-4;
    border-radius: 2px;

    &:hover {
      background: $grey-5;
    }
  }
}

.body--dark .tabs-bar {
  background: $dark;
  border-bottom-color: var(--q-primary);

  &::-webkit-scrollbar-track {
    background: $grey-8;
  }

  &::-webkit-scrollbar-thumb {
    background: $grey-7;

    &:hover {
      background: $grey-6;
    }
  }
}

.tabs-container {
  display: flex;
  gap: 4px;
  padding: 0 8px;
  width: 100%;
  height: 100%;
}

.tabs-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: white;

  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: $grey-5;
  }
}

.body--dark .tabs-content {
  background: $dark;

  .empty-state {
    color: $grey-7;
  }
}
</style>
