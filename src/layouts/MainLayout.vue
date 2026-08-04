<template>
  <q-layout view="hHh LpR fFf">
    <q-header>
      <q-bar class="bar">
        <q-toggle
          v-model="autoSaveModel"
          dense
          size="sm"
          :label="$t('pdfEditor.tools.save.auto')"
          class="header-auto-save"
        />
        <q-btn
          v-for="tool in editorStore.leftHeaderTools"
          :key="tool.id"
          dense
          flat
          :icon="tool.icon"
          :title="tool.label"
          :disable="tool.isDisable?.() ?? false"
          class="header-btn"
          @click="tool.onClicked"
        />

        <q-space />

        <q-toolbar-title class="text-center">{{ $t('title.app') }}</q-toolbar-title>

        <q-space />

        <q-btn
          v-for="tool in editorStore.rightHeaderTools"
          :key="tool.id"
          dense
          flat
          :icon="tool.icon"
          :title="tool.label"
          :disable="tool.isDisable?.() ?? false"
          class="header-btn"
          @click="tool.onClicked"
        />
      </q-bar>
      <div v-if="$q.dark.isActive" class="full-width bg-primary" style="height: 2pt;" />
    </q-header>

    <q-splitter v-model="splitModel" unit="px" emit-immediately :class="splitterClass">
      <template #before>
        <q-drawer
          v-model="showLeftDrawer"
          :width="drawerWidth"
          show-if-above
          bordered
          :breakpoint="0"
          class="drawer-shell"
        >
          <div class="drawer-content">
            <div class="rail-container">
              <q-tabs v-model="selectedTab" vertical switch-indicator class="rail-tabs">
                <q-tab name="docs" icon="library_books" class="rail-tab" />
                <q-tab name="exts" icon="extension" class="rail-tab" />
              </q-tabs>

              <!-- <q-space /> -->

              <!-- 設定：ドキュメントタブと同様に、設定タブをタブ領域に開く -->
              <q-btn
                flat
                dense
                icon="settings"
                size="md"
                class="rail-tab"
                @click="editorStore.openSettingsTab()"
              >
                <q-tooltip>{{ $t('settings.title') }}</q-tooltip>
              </q-btn>
            </div>

            <q-separator vertical />

            <div class="panels-wrapper">
              <q-tab-panels v-model="selectedTab" class="panels">
                <q-tab-panel name="docs" class="q-pa-none">
                  <explorer-view />
                </q-tab-panel>
                <q-tab-panel name="exts" class="q-pa-none">
                  <plugin-list-view />
                </q-tab-panel>
              </q-tab-panels>
            </div>
          </div>
        </q-drawer>
      </template>

      <template #after>
        <q-page-container :style="compPadding">
          <!-- <router-view /> -->
          <editor-page />
        </q-page-container>
      </template>
    </q-splitter>
  </q-layout>
</template>

<script setup lang="ts">
import ExplorerView from 'src/components/MainLayout/ExplorerView.vue';
import PluginListView from 'src/components/MainLayout/PluginListView.vue';
import EditorPage from 'src/pages/EditorPage.vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useEditorStore } from 'src/stores/editorStore';
import { useBackendApi } from 'src/apis/backendApi';

const { t: $t } = useI18n();
const api = useBackendApi();
const editorStore = useEditorStore();
const showLeftDrawer = ref(true);
const selectedTab = ref('docs');

const splitModel = ref(300);
const drawerWidth = computed(() => splitModel.value + 1);

const splitterClass = computed(() => (!showLeftDrawer.value ? 'splitt' : ''));
const compPadding = computed(() => (showLeftDrawer.value ? { paddingLeft: '0px' } : ''));

const autoSaveModel = computed({
  get: () => editorStore.autoSaveAnnotations,
  set: (value: boolean) => {
    editorStore.autoSaveAnnotations = value;
    void api.saveSettings('autoSaveAnnotations', editorStore.autoSaveAnnotations).then((result) => {
      if (!result.ok) {
        editorStore.autoSaveAnnotations = !value;
      }
    });
  },
});
</script>

<style scoped lang="scss">
.splitt {
  .q-splitter__before {
    transition: width 0.2s ease-out;
    width: 0px !important;
  }
}

.drawer-shell {
  overflow: hidden;
}

.drawer-content {
  display: flex;
  height: 100%;
  min-height: 0;
}

.panels-wrapper {
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
}

.panels {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.panels :deep(.q-tab-panel) {
  height: 100%;
  overflow: hidden;
}

.rail-container {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  height: 100%;

  .rail-tabs {
    height: 100%;
  }

  .rail-tab {
    min-height: 48pt;
  }
}

.body--dark {
  .bar {
    background-color: $dark;
  }
}
</style>
