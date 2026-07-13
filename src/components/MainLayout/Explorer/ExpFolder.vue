<template>
  <div class="exp-folder">
    <div
      class="exp-folder-row"
      :class="{ selected: isSelected, 'drag-over': isDragOver }"
      draggable="true"
      @dragstart="onDragStart"
      @dragover="onDragOverTarget"
      @dragleave="onDragLeaveTarget"
      @drop="onDropTarget"
      @click="onClick"
      @contextmenu.prevent="showMenu = true"
    >
      <q-icon :name="expanded ? 'expand_more' : 'chevron_right'" size="18px" />
      <q-icon :name="expanded ? 'folder_open' : 'folder'" color="amber-8" size="18px" />
      <q-input
        v-if="isRenaming"
        v-model="renameValue"
        dense
        autofocus
        borderless
        class="rename-input"
        @keyup.enter="confirmRename"
        @keyup.esc="cancelRename"
        @blur="confirmRename"
        @click.stop
      />
      <p v-else class="q-ma-none folder-name">{{ folderPath.basename() }}</p>

      <q-menu context-menu v-model="showMenu">
        <q-list dense style="min-width: 170px">
          <q-item v-close-popup clickable @click="triggerUpload">
            <q-item-section>{{ $t('explorer.newFile') }}</q-item-section>
          </q-item>
          <q-item v-close-popup clickable @click="createNewFolder">
            <q-item-section>{{ $t('explorer.newFolder') }}</q-item-section>
          </q-item>
          <q-separator />
          <q-item v-close-popup clickable @click="startRename">
            <q-item-section>{{ $t('explorer.rename') }}</q-item-section>
          </q-item>
          <q-item v-close-popup clickable @click="onCut">
            <q-item-section>{{ $t('explorer.cut') }}</q-item-section>
          </q-item>
          <q-item v-close-popup clickable :disable="!hasClipboard" @click="onPaste">
            <q-item-section>{{ $t('explorer.paste') }}</q-item-section>
          </q-item>
          <q-separator />
          <q-item v-close-popup clickable @click="confirmDelete">
            <q-item-section class="text-negative">{{ $t('explorer.delete') }}</q-item-section>
          </q-item>
        </q-list>
      </q-menu>
    </div>

    <input
      ref="uploadInputRef"
      type="file"
      multiple
      class="hidden-upload-input"
      @change="onUploadSelected"
    />

    <div v-if="expanded" class="exp-folder-children">
      <template v-for="child in children" :key="child.path">
        <ExpFile v-if="child.type === 'File'" :file="child" />
        <ExpFolder v-else :folder="child" />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue';
import { Dialog } from 'quasar';
import { useI18n } from 'vue-i18n';
import type { ContainerElementFolder } from 'src/models/container';
import { useExplorerStore } from 'src/stores/explorerStore';
import { useBackendApi } from 'src/apis/backendApi';
import { Path } from 'src/utils/binary/path';
import { DocumentSource } from 'src/models/document/common';
import { arrayBufferToBase64 } from 'src/utils/binary/base64';
import { directChildrenOf, sortElements } from './explorerTree';
import { startElementDrag, useExplorerDnd } from './useExplorerDnd';
import { ExplorerContextKey } from './explorerContext';

interface Prop {
  folder: ContainerElementFolder;
}
const prop = defineProps<Prop>();

const { t: $t } = useI18n();
const explorerStore = useExplorerStore();
const api = useBackendApi();
const ctx = inject(ExplorerContextKey);

const folderPath = computed(() => new Path(prop.folder.path));
const showMenu = ref(false);
const isRenaming = ref(false);
const renameValue = ref('');
const uploadInputRef = ref<HTMLInputElement | null>(null);

const expanded = computed(() =>
  explorerStore.isFolderExpanded(prop.folder.containerID, prop.folder.path),
);
const isSelected = computed(() =>
  explorerStore.isSelected(prop.folder.containerID, prop.folder.path),
);
const hasClipboard = computed(() => explorerStore.clipboard !== null);

const children = computed(() => {
  if (!ctx) return [];
  return sortElements(directChildrenOf(ctx.elements.value, prop.folder.path));
});

const { isDragOver, onDragOverTarget, onDragLeaveTarget, onDropTarget } = useExplorerDnd({
  containerId: prop.folder.containerID,
  targetFolderPath: () => prop.folder.path,
  onChanged: () => ctx?.reload(),
});

function onDragStart(e: DragEvent) {
  startElementDrag(e, prop.folder);
}

function onClick(e: MouseEvent) {
  if (e.ctrlKey || e.metaKey) {
    explorerStore.toggleSelect(prop.folder.containerID, prop.folder.path);
  } else {
    explorerStore.select(prop.folder.containerID, prop.folder.path);
  }
  explorerStore.toggleFolder(prop.folder.containerID, prop.folder.path);
}

function startRename() {
  renameValue.value = folderPath.value.basename();
  isRenaming.value = true;
}

function cancelRename() {
  isRenaming.value = false;
}

async function confirmRename() {
  if (!isRenaming.value) return;
  isRenaming.value = false;

  const newName = renameValue.value.trim();
  if (newName === '' || newName === folderPath.value.basename()) return;

  const newPath = folderPath.value.parent().child(newName).path;
  await api.renamePath(prop.folder, newPath);
  await ctx?.reload();
}

function onCut() {
  explorerStore.setClipboard('cut', [prop.folder]);
}

async function onPaste() {
  const clipboard = explorerStore.clipboard;
  if (!clipboard) return;

  for (const item of clipboard.items) {
    await api.moveElement(item, prop.folder.path);
  }
  explorerStore.clearClipboard();
  await ctx?.reload();
}

function confirmDelete() {
  Dialog.create({
    title: $t('explorer.delete'),
    message: $t('explorer.deleteConfirmFolder', { name: folderPath.value.basename() }),
    cancel: true,
    persistent: true,
  }).onOk(() => {
    void (async () => {
      await api.deleteFolder(prop.folder.containerID, prop.folder);
      await ctx?.reload();
    })();
  });
}

function createNewFolder() {
  Dialog.create({
    title: $t('explorer.newFolder'),
    prompt: { model: '', type: 'text' },
    cancel: true,
    persistent: true,
  }).onOk((name: string) => {
    void (async () => {
      const trimmed = name.trim();
      if (trimmed === '') return;
      await api.createFolder(prop.folder.containerID, folderPath.value.child(trimmed).path);
      await ctx?.reload();
    })();
  });
}

function triggerUpload() {
  uploadInputRef.value?.click();
}

async function onUploadSelected(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);

  for (const file of files) {
    const buffer = await file.arrayBuffer();
    const base64Res = await arrayBufferToBase64(buffer);
    if (!base64Res.ok) continue;
    const targetPath = folderPath.value.child(file.name).path;
    await api.saveFile(prop.folder.containerID, targetPath, DocumentSource.parse(base64Res.value));
  }

  input.value = '';
  await ctx?.reload();
}
</script>

<style lang="scss" scoped>
@use 'sass:color';

.exp-folder-row {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: max-content;
  padding: 2px 4px;
  cursor: pointer;
  transition: 0.2s;
  border-radius: 2px;

  &:hover {
    background: color.adjust(gray, $alpha: -0.5);
  }

  &.selected {
    background: rgba($primary, 0.15);
  }

  &.drag-over {
    outline: 1px dashed $primary;
  }

  .folder-name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .rename-input {
    flex: 1;
    min-width: 0;
  }
}

.exp-folder-children {
  padding-left: 16px;
}

.hidden-upload-input {
  display: none;
}
</style>
