<template>
  <div class="explorer-view">
    <div class="explorer-view-header q-pa-sm">
      <q-btn
        flat
        dense
        round
        icon="note_add"
        size="sm"
        :disable="!explorerStore.lastSelectedKey"
        @click="onNewFile"
      >
        <q-tooltip>
          {{
            explorerStore.lastSelectedKey
              ? $t('explorer.newFile')
              : $t('explorer.selectLocationFirst')
          }}
        </q-tooltip>
      </q-btn>
      <q-btn
        flat
        dense
        round
        icon="create_new_folder"
        size="sm"
        :disable="!explorerStore.lastSelectedKey"
        @click="onNewFolder"
      >
        <q-tooltip>
          {{
            explorerStore.lastSelectedKey
              ? $t('explorer.newFolder')
              : $t('explorer.selectLocationFirst')
          }}
        </q-tooltip>
      </q-btn>
      <q-btn flat dense round icon="add" size="sm" @click="showNewContainerDialog = true">
        <q-tooltip>{{ $t('explorer.addContainer') }}</q-tooltip>
      </q-btn>
    </div>

    <div class="explorer-view-content">
      <ExpContainer
        v-for="container in containers"
        :key="container.id"
        :ref="(el) => setContainerRef(container.id, el)"
        :container="container"
        @closed="loadContainers"
      />

      <q-btn
        v-show="containers.length === 0"
        outline
        :label="$t('explorer.demo')"
        color="primary"
        class="full-width q-my-sm"
        @click="onCreateDemo"
      />
    </div>

    <NewContainerDialog v-model="showNewContainerDialog" @created="loadContainers" />
  </div>
</template>

<script setup lang="ts">
import { useBackendApi } from 'src/apis/backendApi';
import { ref, onMounted } from 'vue';
import ExpContainer from './Explorer/ExpContainer.vue';
import NewContainerDialog from './Explorer/NewContainerDialog.vue';
import { createDemoData } from 'src/utils/appInitializer.js';
import type { ContainerID, ContainerSkel } from 'src/models/container.js';
import { useExplorerStore } from 'src/stores/explorerStore';
import { Path } from 'src/utils/binary/path';

const api = useBackendApi();
const explorerStore = useExplorerStore();

const containers = ref<ContainerSkel[]>([]);
const showNewContainerDialog = ref(false);

interface ExpContainerExposed {
  reload: () => void;
  triggerUpload: (parentPath: string | null) => void;
  createFolderAt: (parentPath: string | null) => Promise<void>;
}
const containerRefs = new Map<ContainerID, ExpContainerExposed>();

function setContainerRef(id: ContainerID, el: unknown) {
  if (el) {
    containerRefs.set(id, el as ExpContainerExposed);
  } else {
    containerRefs.delete(id);
  }
}

async function loadContainers() {
  const apiRes = await api.getAllContainers();
  if (apiRes.ok) {
    containers.value = apiRes.data;
  }
}

async function onCreateDemo() {
  await createDemoData();
  await loadContainers();
}

interface InsertionTarget {
  containerID: ContainerID;
  parentPath: string | null;
}

/**
 * 現在エクスプローラーで選択されている位置から、新規作成の挿入先（コンテナ・親フォルダ）を解決する
 *
 * 選択がファイルの場合はその親フォルダ、フォルダの場合はそのフォルダ自身を挿入先とする。
 * 選択済みの要素が見つからない場合（削除直後など）はコンテナのルートを挿入先とする
 */
async function resolveInsertionTarget(): Promise<InsertionTarget | null> {
  const key = explorerStore.lastSelectedKey;
  if (key === null) return null;

  const separatorIdx = key.indexOf('|');
  if (separatorIdx === -1) return null;
  const containerID = key.slice(0, separatorIdx) as ContainerID;
  const path = key.slice(separatorIdx + 1);

  const containerRes = await api.loadContainer(containerID, false);
  if (!containerRes.ok) return { containerID, parentPath: null };

  const element = containerRes.data.elements[path];
  if (element === undefined) return { containerID, parentPath: null };

  const parentPath =
    element.type === 'Folder' ? element.path : new Path(element.path).parent().path;
  return { containerID, parentPath };
}

async function onNewFile() {
  const target = await resolveInsertionTarget();
  if (!target) return;
  containerRefs.get(target.containerID)?.triggerUpload(target.parentPath);
}

async function onNewFolder() {
  const target = await resolveInsertionTarget();
  if (!target) return;
  await containerRefs.get(target.containerID)?.createFolderAt(target.parentPath);
}

onMounted(loadContainers);
</script>

<style lang="scss" scoped>
.explorer-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.explorer-view-header {
  display: flex;
  justify-content: flex-end;
  gap: 2px;
  flex-shrink: 0;
  padding-bottom: 4px;
}

.explorer-view-content {
  flex: 1 1 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable;
}
</style>
