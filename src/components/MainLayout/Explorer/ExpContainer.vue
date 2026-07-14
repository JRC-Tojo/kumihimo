<template>
  <div class="exp-container">
    <div
      class="exp-container-row"
      :class="{ 'drag-over': isDragOver }"
      @dragover="onDragOverTarget"
      @dragleave="onDragLeaveTarget"
      @drop="onDropTarget"
      @click="onToggle"
      @contextmenu.prevent="showMenu = true"
    >
      <q-icon :name="expanded ? 'expand_more' : 'chevron_right'" size="18px" />
      <q-icon :name="containerIcon" size="18px" color="primary" />
      <p class="q-ma-none container-name" :class="{ 'text-negative': loadError }">
        {{ container.name }}
      </p>
      <q-icon v-if="loadError" name="error" color="negative" size="16px">
        <q-tooltip>{{ loadError }}</q-tooltip>
      </q-icon>
      <q-space />
      <q-btn flat dense round size="sm" icon="refresh" :loading="isLoading" @click.stop="onReload">
        <q-tooltip>{{ $t('button.refresh') }}</q-tooltip>
      </q-btn>

      <q-menu context-menu v-model="showMenu">
        <q-list dense style="min-width: 170px">
          <q-item v-close-popup clickable @click="triggerUpload">
            <q-item-section>{{ $t('explorer.newFile') }}</q-item-section>
          </q-item>
          <q-item v-close-popup clickable @click="createNewFolder">
            <q-item-section>{{ $t('explorer.newFolder') }}</q-item-section>
          </q-item>
          <q-item v-close-popup clickable :disable="!hasClipboard" @click="onPaste">
            <q-item-section>{{ $t('explorer.paste') }}</q-item-section>
          </q-item>
          <q-separator />
          <q-item v-close-popup clickable @click="onUnload">
            <q-item-section>{{ $t('explorer.closeContainer') }}</q-item-section>
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

    <div v-if="expanded" class="exp-container-body">
      <div v-if="needsReconnect" class="reconnect-banner">
        <q-icon name="lock" size="16px" />
        <span>{{ $t('explorer.permissionNeeded') }}</span>
        <q-btn flat dense size="sm" color="primary" @click="onReconnect">
          {{ $t('explorer.reconnect') }}
        </q-btn>
      </div>

      <div v-if="changesDetected" class="changes-banner" @click="onReload">
        <q-icon name="sync_problem" size="16px" />
        <span>{{ $t('explorer.changesDetected') }}</span>
      </div>

      <div v-if="conflictDetected" class="conflict-banner">
        <q-icon name="error" size="16px" />
        <span>{{ $t('explorer.changesConflict', { names: conflictFileNames.join(', ') }) }}</span>
      </div>

      <template v-for="child in children" :key="child.path">
        <ExpFile v-if="child.type === 'File'" :file="child" />
        <ExpFolder v-else :folder="child" />
      </template>

      <p v-if="!isLoading && children.length === 0" class="empty-hint">
        {{ $t('explorer.emptyContainer') }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Container, ContainerID, ContainerSkel, RenamedEntry } from 'src/models/container';
import { useExplorerStore } from 'src/stores/explorerStore';
import { useEditorStore } from 'src/stores/editorStore';
import { useBackendApi } from 'src/apis/backendApi';
import { DocumentSource } from 'src/models/document/common';
import { arrayBufferToBase64 } from 'src/utils/binary/base64';
import { Path } from 'src/utils/binary/path';
import { directChildrenOf, sortElements } from './explorerTree';
import { useExplorerDnd } from './useExplorerDnd';
import { ExplorerContextKey } from './explorerContext';
import ExpFile from './ExpFile.vue';
import ExpFolder from './ExpFolder.vue';
import { syncStoresAfterRename } from 'src/utils/document/syncStoresAfterRename';
import { confirmDialog, promptDialog } from 'src/utils/dialog/confirmDialog';

interface Prop {
  container: ContainerSkel;
}
const prop = defineProps<Prop>();
const emit = defineEmits<{ closed: [] }>();

const { t: $t } = useI18n();
const explorerStore = useExplorerStore();
const editorStore = useEditorStore();
const api = useBackendApi();

const isLoading = ref(false);
const showMenu = ref(false);
const uploadInputRef = ref<HTMLInputElement | null>(null);
const uploadTargetPath = ref<string | null>(null);
const needsReconnect = ref(false);
const changesDetected = ref(false);
const conflictDetected = ref(false);
const conflictFileNames = ref<string[]>([]);
const loadedContainer = ref<Container | null>(null);
const loadError = ref<string | null>(null);

const expanded = computed(() => explorerStore.isContainerExpanded(prop.container.id));
const hasClipboard = computed(() => explorerStore.clipboard !== null);
const containerIcon = computed(() => {
  switch (prop.container.type) {
    case 'local':
      return 'folder_shared';
    case 'box':
      return 'cloud';
    default:
      return 'storage';
  }
});

const elements = computed(() => loadedContainer.value?.elements ?? {});
const children = computed(() => sortElements(directChildrenOf(elements.value, null)));

provide(ExplorerContextKey, {
  containerId: prop.container.id,
  elements,
  reload: () => load(false),
  containerPath: prop.container.containerPath,
});

async function load(forceReload: boolean): Promise<void> {
  isLoading.value = true;
  changesDetected.value = false;
  conflictDetected.value = false;
  conflictFileNames.value = [];

  if (prop.container.type === 'local') {
    const permRes = await api.checkContainerPermission(prop.container.id);
    needsReconnect.value = permRes.ok && permRes.data !== 'granted';
    if (needsReconnect.value) {
      loadError.value = null;
      isLoading.value = false;
      return;
    }
  }

  const res = await api.loadContainer(prop.container.id, forceReload);
  if (res.ok) {
    loadedContainer.value = res.data;
    loadError.value = null;
  } else {
    loadError.value = res.error.error.message || res.error.key;
  }
  isLoading.value = false;
}

function onToggle() {
  explorerStore.toggleContainer(prop.container.id);
}

function onReload() {
  void load(true);
}

async function onReconnect() {
  const res = await api.requestContainerPermission(prop.container.id);
  if (res.ok) await load(true);
}

async function onUnload() {
  const ok = await confirmDialog({
    title: $t('explorer.closeContainer'),
    message: $t('explorer.closeContainerConfirm', { name: prop.container.name }),
  });
  if (!ok) return;

  await api.unloadContainer(prop.container.id, false);
  emit('closed');
}

async function onPaste() {
  const clipboard = explorerStore.clipboard;
  if (!clipboard) return;

  const renamedByContainer = new Map<ContainerID, RenamedEntry[]>();
  for (const item of clipboard.items) {
    const moveRes = await api.moveElement(item, '.');
    if (!moveRes.ok) continue;
    const list = renamedByContainer.get(item.containerID) ?? [];
    list.push(...moveRes.data);
    renamedByContainer.set(item.containerID, list);
  }
  renamedByContainer.forEach((entries, cID) => syncStoresAfterRename(cID, entries));

  explorerStore.clearClipboard();
  await load(false);
}

async function createNewFolderAt(parentPath: string | null) {
  const name = await promptDialog({
    title: $t('explorer.newFolder'),
    promptLabel: $t('explorer.newFolder'),
  });
  if (name === undefined) return;

  const trimmed = name.trim();
  if (trimmed === '') return;
  const targetPath = parentPath ? new Path(parentPath).child(trimmed).path : trimmed;
  await api.createFolder(prop.container.id, targetPath);
  await load(false);
}

function createNewFolder() {
  void createNewFolderAt(null);
}

function triggerUploadAt(parentPath: string | null) {
  uploadTargetPath.value = parentPath;
  uploadInputRef.value?.click();
}

function triggerUpload() {
  triggerUploadAt(null);
}

async function onUploadSelected(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  const parentPath = uploadTargetPath.value;

  for (const file of files) {
    const buffer = await file.arrayBuffer();
    const base64Res = await arrayBufferToBase64(buffer);
    if (!base64Res.ok) continue;
    const targetPath = parentPath ? new Path(parentPath).child(file.name).path : file.name;
    await api.saveFile(prop.container.id, targetPath, DocumentSource.parse(base64Res.value));
  }

  input.value = '';
  uploadTargetPath.value = null;
  await load(false);
}

defineExpose({
  reload: () => load(true),
  triggerUpload: triggerUploadAt,
  createFolderAt: createNewFolderAt,
});

const { isDragOver, onDragOverTarget, onDragLeaveTarget, onDropTarget } = useExplorerDnd({
  containerId: prop.container.id,
  targetFolderPath: () => null,
  onChanged: () => load(false),
});

// local型コンテナのみ、展開中はフォーカス復帰時に軽量な変更検知を行う
let pollTimer: ReturnType<typeof setInterval> | undefined;

/**
 * 現在アプリ側が「関連している」と認識しているファイルパス一覧を返す
 *
 * 全ペインで開いているタブ ∪ 関係性キャッシュで参照されているファイルを対象とする。
 * これに含まれないファイルの変更は、アプリの表示・データに影響しないため通知不要と判断する
 */
async function getRelevantPaths(): Promise<Set<string>> {
  const relevant = new Set<string>();
  (['ul', 'ur', 'll', 'lr'] as const).forEach((side) => {
    editorStore.tabs[side].forEach((tab) => {
      if (tab.containerID === prop.container.id) relevant.add(tab.path);
    });
  });

  const refRes = await api.getRelationalReferencedPaths(prop.container.id);
  if (refRes.ok) refRes.data.forEach((path) => relevant.add(path));

  return relevant;
}

/**
 * 外部での変更を検知し、関連ファイルの有無・未保存の変更との衝突有無に応じて挙動を分ける
 *
 * - 無関係なファイルの変更のみ：バナーを出さず静かに確定コミットする
 * - 関連ファイルの変更で、未保存の変更との衝突が無い：既存のクリックして更新バナーを出す
 * - 関連ファイルの変更が、そのファイル自身の未保存の変更と衝突する：コンフリクトバナーを出し、
 *   ユーザーが保存の上で明示的に更新ボタンを押すまで一切コミットしない（両者の変更を保護する）
 */
async function checkForChanges(): Promise<void> {
  if (prop.container.type !== 'local' || !expanded.value || needsReconnect.value) return;

  // 検知のためだけに読み取る（共有キャッシュはコミットしない。コミットは`load()`経由のみで行う）
  const peekRes = await api.peekContainerElements(prop.container.id);
  if (!peekRes.ok) return;

  const before = elements.value;
  const after = peekRes.data.elements;
  const changedPaths = new Set(
    [...Object.keys(before), ...Object.keys(after)].filter(
      (path) => before[path] === undefined || after[path] === undefined,
    ),
  );
  if (changedPaths.size === 0) return;

  const relevantPaths = await getRelevantPaths();
  const relevantChangedPaths = Array.from(changedPaths).filter((path) => relevantPaths.has(path));
  if (relevantChangedPaths.length === 0) {
    // 無関係なファイルの変更のみ：確認なしで静かに確定コミットする
    await load(true);
    return;
  }

  // 変更された関連ファイルの中に、そのファイル自身が未保存の変更を持つものがあるか確認する
  const conflictNames: string[] = [];
  for (const path of relevantChangedPaths) {
    const elem = before[path] ?? after[path];
    if (elem === undefined || elem.type !== 'File') continue;

    const unsavedRes = await api.hasUnsavedChangesByFile(elem);
    if (unsavedRes.ok && unsavedRes.data) conflictNames.push(new Path(path).basename());
  }

  if (conflictNames.length > 0) {
    conflictDetected.value = true;
    conflictFileNames.value = conflictNames;
    return;
  }

  changesDetected.value = true;
}

function onFocus() {
  void checkForChanges();
}

watch(expanded, (isExpanded) => {
  // 展開時に未読み込み・前回失敗のいずれかであれば再試行する
  if (isExpanded && loadedContainer.value === null) void load(false);
});

onMounted(() => {
  // 展開状態に関わらず読み込みを試行する（折りたたみ中でもエラー状態を把握できるようにするため。
  // 実データ内容は読まないメタ情報のみの取得のため、コストは小さい）
  void load(false);
  window.addEventListener('focus', onFocus);
  pollTimer = setInterval(() => void checkForChanges(), 30000);
});

onBeforeUnmount(() => {
  window.removeEventListener('focus', onFocus);
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<style lang="scss" scoped>
.exp-container-row {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  cursor: pointer;
  font-weight: 600;

  &:hover {
    background: rgba(0, 0, 0, 0.05);
  }

  &.drag-over {
    outline: 1px dashed $primary;
  }

  .container-name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
}

.exp-container-body {
  padding-left: 8px;
}

.reconnect-banner,
.changes-banner,
.conflict-banner {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  font-size: 0.8rem;
  background: rgba($warning, 0.15);
  border-radius: 4px;
  margin: 2px 4px;
}

.changes-banner {
  cursor: pointer;
}

.conflict-banner {
  background: rgba($negative, 0.15);
  color: $negative;
}

.empty-hint {
  padding: 4px 8px;
  font-size: 0.8rem;
  color: $grey-6;
}

.hidden-upload-input {
  display: none;
}
</style>
