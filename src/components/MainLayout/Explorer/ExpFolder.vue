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
        :error="!!renameError"
        :error-message="renameError ?? undefined"
        hide-bottom-space
        @keyup.enter="confirmRename"
        @keyup.esc="cancelRename"
        @blur="confirmRename"
        @click.stop
      />
      <p v-else class="q-ma-none folder-name">{{ folderPath.basename() }}</p>

      <q-menu context-menu v-model="showMenu" @hide="onMenuHide">
        <q-list dense style="min-width: 170px">
          <q-item v-close-popup clickable @click="triggerUpload">
            <q-item-section>{{ $t('explorer.newFile') }}</q-item-section>
          </q-item>
          <q-item v-close-popup clickable @click="createNewFolder">
            <q-item-section>{{ $t('explorer.newFolder') }}</q-item-section>
          </q-item>
          <q-separator />
          <q-item v-close-popup clickable @click="requestRename">
            <q-item-section>{{ $t('explorer.rename') }}</q-item-section>
          </q-item>
          <q-item v-close-popup clickable @click="onCut">
            <q-item-section>{{ $t('explorer.cut') }}</q-item-section>
          </q-item>
          <q-item v-close-popup clickable :disable="!hasClipboard" @click="onPaste">
            <q-item-section>{{ $t('explorer.paste') }}</q-item-section>
          </q-item>
          <q-separator />
          <q-item v-close-popup clickable @click="onCopyRelativePath">
            <q-item-section>{{ $t('explorer.copyRelativePath') }}</q-item-section>
          </q-item>
          <q-item v-close-popup clickable @click="onCopyAbsolutePath">
            <q-item-section>{{ $t('explorer.copyAbsolutePath') }}</q-item-section>
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
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import type { ContainerElementFolder, ContainerID, RenamedEntry } from 'src/models/container';
import { useExplorerStore } from 'src/stores/explorerStore';
import { useBackendApi } from 'src/apis/backendApi';
import { Path } from 'src/utils/binary/path';
import { DocumentSource } from 'src/models/document/common';
import { arrayBufferToBase64 } from 'src/utils/binary/base64';
import { directChildrenOf, sortElements } from './explorerTree';
import { startElementDrag, useExplorerDnd } from './useExplorerDnd';
import { ExplorerContextKey } from './explorerContext';
import ExpFile from './ExpFile.vue';
import { syncStoresAfterRename } from 'src/utils/document/syncStoresAfterRename';
import { syncStoresAfterDelete } from 'src/utils/document/syncStoresAfterDelete';
import { confirmDialog, promptDialog } from 'src/components/Dialog/confirmDialog';

interface Prop {
  folder: ContainerElementFolder;
}
const prop = defineProps<Prop>();

const { t: $t } = useI18n();
const $q = useQuasar();
const explorerStore = useExplorerStore();
const api = useBackendApi();
const ctx = inject(ExplorerContextKey);

const folderPath = computed(() => new Path(prop.folder.path));
const showMenu = ref(false);
const isRenaming = ref(false);
const renameValue = ref('');
const uploadInputRef = ref<HTMLInputElement | null>(null);
const pendingRename = ref(false);

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

/**
 * 名前変更の予約のみ行う（メニュー項目クリック時点ではまだ入力欄を出さない）
 *
 * コンテキストメニューが閉じるアニメーション・フォーカス処理と同時に入力欄へautofocusすると、
 * メニュー側が閉じる際にフォーカスを奪い返してすぐ`blur`が発生し、
 * 入力欄が一瞬で消えてしまう（`confirmRename`が即座に呼ばれてしまう）ため、
 * メニューが完全に閉じ切った後（`@hide`）に入力欄を表示するようにする
 */
function requestRename() {
  pendingRename.value = true;
}

function onMenuHide() {
  if (!pendingRename.value) return;
  pendingRename.value = false;
  renameValue.value = folderPath.value.basename();
  isRenaming.value = true;
}

function cancelRename() {
  isRenaming.value = false;
}

const forbiddenPathChars = /[\\/]/;

/** 同一階層に存在する兄弟要素の名称一覧を返す（自分自身は除外） */
function siblingBasenames(): Set<string> {
  const elements = ctx?.elements.value ?? {};
  const parentPath = folderPath.value.parent().path;
  const names = new Set<string>();
  for (const elem of Object.values(elements)) {
    if (elem.path === prop.folder.path) continue;
    const elemPath = new Path(elem.path);
    if (elemPath.parent().path === parentPath) {
      names.add(elemPath.basename());
    }
  }
  return names;
}

/**
 * リネーム値を検証する
 *
 * 空文字・"."/".."・パス区切り文字を含む値・同一階層の既存名との重複を拒否する
 * @returns エラーメッセージ（問題がなければnull）
 */
function validateRenameValue(val: string): string | null {
  const trimmed = val.trim();
  if (trimmed === '') return $t('explorer.invalidFileNameEmpty');
  if (trimmed === '.' || trimmed === '..' || forbiddenPathChars.test(trimmed)) {
    return $t('explorer.invalidFileName');
  }
  if (trimmed !== folderPath.value.basename() && siblingBasenames().has(trimmed)) {
    return $t('explorer.duplicateName');
  }
  return null;
}

const renameError = computed(() =>
  isRenaming.value ? validateRenameValue(renameValue.value) : null,
);

async function confirmRename() {
  if (!isRenaming.value) return;
  if (renameError.value) {
    // 無効な入力のまま確定された場合はリネームを取り消す
    cancelRename();
    return;
  }
  isRenaming.value = false;

  const newName = renameValue.value.trim();
  if (newName === folderPath.value.basename()) return;

  const newPath = folderPath.value.parent().child(newName).path;
  const renameRes = await api.renamePath(prop.folder, newPath);
  if (renameRes.ok) syncStoresAfterRename(prop.folder.containerID, renameRes.data);
  await ctx?.reload();
}

function onCut() {
  explorerStore.setClipboard('cut', [prop.folder]);
}

async function onPaste() {
  const clipboard = explorerStore.clipboard;
  if (!clipboard) return;

  const renamedByContainer = new Map<ContainerID, RenamedEntry[]>();
  for (const item of clipboard.items) {
    const moveRes = await api.moveElement(item, prop.folder.path);
    if (!moveRes.ok) continue;
    const list = renamedByContainer.get(item.containerID) ?? [];
    list.push(...moveRes.data);
    renamedByContainer.set(item.containerID, list);
  }
  renamedByContainer.forEach((entries, cID) => syncStoresAfterRename(cID, entries));

  explorerStore.clearClipboard();
  await ctx?.reload();
}

async function onCopyRelativePath() {
  await navigator.clipboard.writeText(folderPath.value.path);
  $q.notify({ type: 'positive', message: $t('explorer.pathCopied') });
}

async function onCopyAbsolutePath() {
  const containerPath = ctx?.containerPath ?? '.';
  const absolutePath = new Path(containerPath).child(folderPath.value.path).path;
  await navigator.clipboard.writeText(absolutePath);
  $q.notify({ type: 'positive', message: $t('explorer.pathCopied') });
}

async function confirmDelete() {
  const ok = await confirmDialog({
    title: $t('explorer.delete'),
    message: $t('explorer.deleteConfirmFolder', { name: folderPath.value.basename() }),
    severity: 'negative',
  });
  if (!ok) return;

  const prefix = `${prop.folder.path}/`;
  const descendants = ctx
    ? Object.values(ctx.elements.value).filter((e) => e.path.startsWith(prefix))
    : [];

  const deleteRes = await api.deleteFolder(prop.folder.containerID, prop.folder);
  if (deleteRes.ok) {
    syncStoresAfterDelete(prop.folder.containerID, [prop.folder, ...descendants]);
  }
  await ctx?.reload();
}

async function createNewFolder() {
  const name = await promptDialog({
    title: $t('explorer.newFolder'),
    promptLabel: $t('explorer.newFolder'),
  });
  if (name === undefined) return;

  const trimmed = name.trim();
  if (trimmed === '') return;
  await api.createFolder(prop.folder.containerID, folderPath.value.child(trimmed).path);
  await ctx?.reload();
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
  min-width: 0;
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
    flex: 1 1 auto;
    min-width: 0;
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
  margin-left: 12px;
  padding-left: 3px;
  border-left: 1px solid rgba(128, 128, 128, 0.3);
}

.hidden-upload-input {
  display: none;
}
</style>
