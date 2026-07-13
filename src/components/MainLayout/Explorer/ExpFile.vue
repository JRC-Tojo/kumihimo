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
        <q-item v-close-popup clickable @click="confirmDelete">
          <q-item-section class="text-negative">{{ $t('explorer.delete') }}</q-item-section>
        </q-item>
      </q-list>
    </q-menu>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue';
import { Dialog } from 'quasar';
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
import { useUnsavedIndicator } from 'src/composables/useUnsavedIndicator';

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

function onClick(e: MouseEvent) {
  if (e.ctrlKey || e.metaKey) {
    explorerStore.toggleSelect(prop.file.containerID, prop.file.path);
    return;
  }
  explorerStore.select(prop.file.containerID, prop.file.path);
  editStore.openTab(prop.file);
}

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

function onMenuHide() {
  if (!pendingRename.value) return;
  pendingRename.value = false;
  renameValue.value = filePath.value.basename();
  isRenaming.value = true;
}

function cancelRename() {
  isRenaming.value = false;
}

async function confirmRename() {
  if (!isRenaming.value) return;
  isRenaming.value = false;

  const newName = renameValue.value.trim();
  if (newName === '' || newName === filePath.value.basename()) return;

  const newPath = filePath.value.parent().child(newName).path;
  const renameRes = await api.renamePath(prop.file, newPath);
  if (renameRes.ok) syncStoresAfterRename(prop.file.containerID, renameRes.data);
  await ctx?.reload();
}

function onCut() {
  explorerStore.setClipboard('cut', [prop.file]);
}

function confirmDelete() {
  Dialog.create({
    title: $t('explorer.delete'),
    message: $t('explorer.deleteConfirmFile', { name: filePath.value.basename() }),
    cancel: true,
    persistent: true,
  }).onOk(() => {
    void (async () => {
      await api.deleteFile(prop.file.containerID, prop.file);
      await ctx?.reload();
    })();
  });
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
