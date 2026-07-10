<template>
  <q-layout view="hHh LpR fFf">
    <q-header>
      <q-bar>
        <q-toolbar-title class="text-center">{{ $t('title.app') }}</q-toolbar-title>
      </q-bar>
    </q-header>

    <q-splitter v-model="splitModel" unit="px" emit-immediately :class="splitterClass">
      <template #before>
        <q-drawer
          v-model="showLeftDrawer"
          :width="drawerWidth"
          show-if-above
          bordered
          :breakpoint="0"
          class="row"
        >
          <div class="rail-container">
            <q-tabs v-model="selectedTab" vertical switch-indicator class="rail-tabs">
              <q-tab name="docs" icon="library_books" />
              <q-tab name="exts" icon="extension" />
            </q-tabs>

            <q-space />

            <!-- 設定：ドキュメントタブと同様に、設定タブをタブ領域に開く -->
            <q-btn
              flat
              dense
              icon="settings"
              size="md"
              class="rail-settings-btn"
              @click="editorStore.openSettingsTab()"
            >
              <q-tooltip>{{ $t('settings.title') }}</q-tooltip>
            </q-btn>
          </div>

          <q-separator vertical />

          <q-tab-panels v-model="selectedTab" class="panels">
            <q-tab-panel name="docs">
              <explorer-view />
            </q-tab-panel>
            <q-tab-panel name="exts"> This is Extensions </q-tab-panel>
          </q-tab-panels>
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
import EditorPage from 'src/pages/EditorPage.vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useEditorStore } from 'src/stores/editorStore';

const { t: $t } = useI18n();
const editorStore = useEditorStore();
const showLeftDrawer = ref(true);
const selectedTab = ref('docs');

const splitModel = ref(300);
const drawerWidth = computed(() => splitModel.value + 1);

const splitterClass = computed(() => (!showLeftDrawer.value ? 'splitt' : ''));
const compPadding = computed(() => (showLeftDrawer.value ? { paddingLeft: '0px' } : ''));
</script>

<style scoped lang="scss">
.splitt {
  .q-splitter__before {
    transition: width 0.2s ease-out;
    width: 0px !important;
  }
}

.panels {
  flex: 1 1 0;
  overflow-x: hidden;
}

.rail-container {
  display: flex;
  flex-direction: column;
  height: 100%;

  .rail-tabs {
    flex: 0 0 auto;
  }

  .rail-settings-btn {
    flex: 0 0 auto;
    margin-bottom: 8px;
  }
}
</style>
