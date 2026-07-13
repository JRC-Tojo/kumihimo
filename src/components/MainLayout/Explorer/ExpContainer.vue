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
import { Dialog } from 'quasar';
import { useI18n } from 'vue-i18n';
import type { Container, ContainerSkel } from 'src/models/container';
import { useExplorerStore } from 'src/stores/explorerStore';
import { useBackendApi } from 'src/apis/backendApi';
import { DocumentSource } from 'src/models/document/common';
import { arrayBufferToBase64 } from 'src/utils/binary/base64';
import { directChildrenOf, sortElements } from './explorerTree';
import { useExplorerDnd } from './useExplorerDnd';
import { ExplorerContextKey } from './explorerContext';
import ExpFile from './ExpFile.vue';
import ExpFolder from './ExpFolder.vue';

interface Prop {
  container: ContainerSkel;
}
const prop = defineProps<Prop>();
const emit = defineEmits<{ closed: [] }>();

const { t: $t } = useI18n();
const explorerStore = useExplorerStore();
const api = useBackendApi();

const isLoading = ref(false);
const showMenu = ref(false);
const uploadInputRef = ref<HTMLInputElement | null>(null);
const needsReconnect = ref(false);
const changesDetected = ref(false);
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
});

async function load(forceReload: boolean): Promise<void> {
  isLoading.value = true;
  changesDetected.value = false;

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

function onUnload() {
  Dialog.create({
    title: $t('explorer.closeContainer'),
    message: $t('explorer.closeContainerConfirm', { name: prop.container.name }),
    cancel: true,
    persistent: true,
  }).onOk(() => {
    void (async () => {
      await api.unloadContainer(prop.container.id, false);
      emit('closed');
    })();
  });
}

async function onPaste() {
  const clipboard = explorerStore.clipboard;
  if (!clipboard) return;

  for (const item of clipboard.items) {
    await api.moveElement(item, '.');
  }
  explorerStore.clearClipboard();
  await load(false);
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
      await api.createFolder(prop.container.id, trimmed);
      await load(false);
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
    await api.saveFile(prop.container.id, file.name, DocumentSource.parse(base64Res.value));
  }

  input.value = '';
  await load(false);
}

const { isDragOver, onDragOverTarget, onDragLeaveTarget, onDropTarget } = useExplorerDnd({
  containerId: prop.container.id,
  targetFolderPath: () => null,
  onChanged: () => load(false),
});

// local型コンテナのみ、展開中はフォーカス復帰時に軽量な変更検知を行う
let pollTimer: ReturnType<typeof setInterval> | undefined;

async function checkForChanges(): Promise<void> {
  if (prop.container.type !== 'local' || !expanded.value || needsReconnect.value) return;
  const res = await api.loadContainer(prop.container.id, true);
  if (!res.ok) return;

  const before = elements.value;
  const after = res.data.elements;
  const isDifferent =
    Object.keys(before).length !== Object.keys(after).length ||
    Object.keys(after).some((path) => before[path] === undefined);
  if (isDifferent) {
    changesDetected.value = true;
  }
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
.changes-banner {
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

.empty-hint {
  padding: 4px 8px;
  font-size: 0.8rem;
  color: $grey-6;
}

.hidden-upload-input {
  display: none;
}
</style>
