<template>
  <div
    class="exp-file"
    :class="{ selected: isSelected }"
    draggable="true"
    @dragstart="onDragStart"
    @click="onClick"
    @contextmenu.prevent="showMenu = true"
  >
    <q-icon :name="iconName" :color="iconColor" size="18px" />
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
    <p v-else class="q-ma-none file-name" :class="statusClass">{{ filePath.basename() }}</p>
    <span v-if="hasUnsavedChanges" class="unsaved-dot" :title="$t('explorer.unsavedChanges')" />

    <q-menu context-menu v-model="showMenu" @hide="onMenuHide">
      <q-list dense style="min-width: 150px">
        <q-item v-close-popup clickable @click="requestRename">
          <q-item-section>{{ $t('explorer.rename') }}</q-item-section>
        </q-item>
        <q-item v-close-popup clickable @click="onCut">
          <q-item-section>{{ $t('explorer.cut') }}</q-item-section>
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
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ContainerElementFile } from 'src/models/container';
import { useEditorStore } from 'src/stores/editorStore';
import { useExplorerStore } from 'src/stores/explorerStore';
import { useRelationalStore, fileKey } from 'src/stores/relationalStore';
import { useBackendApi } from 'src/apis/backendApi';
import { Path } from 'src/utils/binary/path';
import { getSupportedDocumentKind } from 'src/utils/document/supportedTypes';
import { startElementDrag } from './useExplorerDnd';
import { ExplorerContextKey } from './explorerContext';
import { syncStoresAfterRename } from 'src/utils/document/syncStoresAfterRename';
import { syncStoresAfterDelete } from 'src/utils/document/syncStoresAfterDelete';
import { useUnsavedIndicator } from 'src/composables/useUnsavedIndicator';
import { confirmDialog } from 'src/components/Dialog/confirmDialog';

interface Prop {
  file: ContainerElementFile;
}
const prop = defineProps<Prop>();

const { t: $t } = useI18n();
const editStore = useEditorStore();
const explorerStore = useExplorerStore();
const relationalStore = useRelationalStore();
const api = useBackendApi();
const ctx = inject(ExplorerContextKey);

const filePath = computed(() => new Path(prop.file.path));
const showMenu = ref(false);
const isRenaming = ref(false);
const renameValue = ref('');
const pendingRename = ref(false);

const isSelected = computed(() => explorerStore.isSelected(prop.file.containerID, prop.file.path));

const documentKind = computed(() => getSupportedDocumentKind(prop.file.path));
const iconName = computed(() => {
  switch (documentKind.value) {
    case 'pdf':
      return 'picture_as_pdf';
    case 'text':
      return 'description';
    default:
      return 'insert_drive_file';
  }
});
const iconColor = computed(() => (documentKind.value === 'unsupported' ? 'grey-6' : 'red'));

const { hasUnsavedChanges } = useUnsavedIndicator(computed(() => prop.file));

const status = computed(() => relationalStore.statusForFile(fileKey(prop.file)));
const statusClass = computed(() => {
  if (status.value === 'ng') return 'text-negative';
  if (status.value === 'ok') return 'text-positive';
  return '';
});

/** クリック操作で要素を選択し、必要に応じてタブを開く */
function onClick(e: MouseEvent) {
  if (e.ctrlKey || e.metaKey) {
    explorerStore.toggleSelect(prop.file.containerID, prop.file.path);
    return;
  }
  explorerStore.select(prop.file.containerID, prop.file.path);
  editStore.openTab(prop.file);
}

/** ドラッグ開始時に内部移動用の要素情報を保持する */
function onDragStart(e: DragEvent) {
  startElementDrag(e, prop.file);
}

/**
 * 名前変更の予約のみ行う（メニュー項目クリック時点ではまだ入力欄を出さない）
 *
 * コンテキストメニューが閉じる処理と同時に入力欄へautofocusすると、メニュー側が
 * フォーカスを奪い返して即座に`blur`（=`confirmRename`即時実行）が発生し、
 * 入力欄が一瞬で消えてしまうため、メニューが完全に閉じた後（`@hide`）に表示する
 */
function requestRename() {
  pendingRename.value = true;
}

/** コンテキストメニューが閉じた後に、予約済みの名前変更入力を開始する */
function onMenuHide() {
  if (!pendingRename.value) return;
  pendingRename.value = false;
  renameValue.value = filePath.value.basename();
  isRenaming.value = true;
}

/** 名前変更入力を中断する */
function cancelRename() {
  isRenaming.value = false;
}

const forbiddenPathChars = /[\\/]/;

/** 同一階層に存在する兄弟要素のファイル名一覧を返す（自分自身は除外） */
function siblingBasenames(): Set<string> {
  const elements = ctx?.elements.value ?? {};
  const parentPath = filePath.value.parent().path;
  const names = new Set<string>();
  for (const elem of Object.values(elements)) {
    if (elem.path === prop.file.path) continue;
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
  if (trimmed !== filePath.value.basename() && siblingBasenames().has(trimmed)) {
    return $t('explorer.duplicateName');
  }
  return null;
}

const renameError = computed(() =>
  isRenaming.value ? validateRenameValue(renameValue.value) : null,
);

/** 入力内容をもとに実際のパス変更を実行する */
async function confirmRename() {
  if (!isRenaming.value) return;
  if (renameError.value) {
    // 無効な入力のまま確定された場合はリネームを取り消す
    cancelRename();
    return;
  }
  isRenaming.value = false;

  const newName = renameValue.value.trim();
  if (newName === filePath.value.basename()) return;

  const newPath = filePath.value.parent().child(newName).path;
  const renameRes = await api.renamePath(prop.file, newPath);
  if (renameRes.ok) syncStoresAfterRename(prop.file.containerID, renameRes.data);
  await ctx?.reload();
}

/** 現在要素を切り取り先として保存する */
function onCut() {
  explorerStore.setClipboard('cut', [prop.file]);
}

/** 相対パスをクリップボードへコピーする */
async function onCopyRelativePath() {
  await navigator.clipboard.writeText(filePath.value.path);
}

/** コンテナ基準の絶対パスをクリップボードへコピーする */
async function onCopyAbsolutePath() {
  const containerPath = ctx?.containerPath ?? '.';
  const absolutePath = new Path(containerPath).child(filePath.value.path).path;
  await navigator.clipboard.writeText(absolutePath);
}

/** 削除確認後に要素を削除する */
async function confirmDelete() {
  const ok = await confirmDialog({
    title: $t('explorer.delete'),
    message: $t('explorer.deleteConfirmFile', { name: filePath.value.basename() }),
    severity: 'negative',
  });
  if (!ok) return;

  const deleteRes = await api.deleteFile(prop.file.containerID, prop.file);
  if (deleteRes.ok) syncStoresAfterDelete(prop.file.containerID, [prop.file]);
  await ctx?.reload();
}
</script>

<style lang="scss" scoped>
@use 'sass:color';

.exp-file {
  display: flex;
  align-items: center;
  gap: 4px;
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

  .file-name {
    flex: 1 1 auto;
    min-width: 0;
    background: transparent;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .unsaved-dot {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: $warning;
  }

  .rename-input {
    flex: 1;
    min-width: 0;
  }
}
</style>
