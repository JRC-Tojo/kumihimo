<template>
  <div class="explorer-bookmarks-panel">
    <div class="q-px-sm q-pb-xs row items-center">
      <q-btn flat dense round icon="add" size="sm" :disable="!activeFile" @click="onAddBookmark">
        <q-tooltip>{{ $t('explorer.bookmarks.add') }}</q-tooltip>
      </q-btn>
    </div>

    <div v-if="loading" class="q-pa-md text-center">
      <q-spinner color="primary" size="1.5em" />
    </div>
    <div v-else-if="items.length === 0" class="q-pa-md text-center text-grey">
      {{ $t('explorer.bookmarks.noBookmarks') }}
    </div>
    <q-list v-else>
      <q-item
        v-for="item in items"
        :key="item.key"
        clickable
        :disable="item.pageNumber === undefined"
        @click="onJump(item)"
      >
        <q-item-section avatar>
          <q-icon
            :name="item.source === 'pdf' ? 'toc' : 'bookmark'"
            :color="item.source === 'pdf' ? 'grey-7' : 'amber'"
          />
        </q-item-section>
        <q-item-section>
          <q-input
            v-if="renamingKey === item.key"
            v-model="renameValue"
            dense
            autofocus
            borderless
            @keyup.enter="confirmRename(item)"
            @keyup.esc="cancelRename"
            @blur="confirmRename(item)"
            @click.stop
          />
          <template v-else>
            <q-item-label>{{ item.title }}</q-item-label>
            <q-item-label v-if="item.pageNumber !== undefined" caption>
              {{ $t('explorer.bookmarks.page') }} {{ item.pageNumber }}
            </q-item-label>
          </template>
        </q-item-section>
        <q-item-section v-if="item.source === 'user'" side>
          <div class="row no-wrap">
            <q-btn flat dense round icon="edit" size="sm" @click.stop="startRename(item)" />
            <q-btn flat dense round icon="delete" size="sm" @click.stop="onDelete(item)" />
          </div>
        </q-item-section>
      </q-item>
    </q-list>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useBackendApi } from 'src/apis/backendApi';
import { useEditorStore } from 'src/stores/editorStore';
import type { BookmarkID } from 'src/models/relational/fileSchema';
import { getSupportedDocumentKind } from 'src/utils/document/supportedTypes';

interface BookmarkItem {
  key: string;
  title: string;
  pageNumber: number | undefined;
  source: 'pdf' | 'user';
  bookmarkId?: BookmarkID;
}

const { t: $t } = useI18n();
const api = useBackendApi();
const editorStore = useEditorStore();

const activeFile = computed(() => editorStore.getActiveTab(editorStore.activeSide));

const loading = ref(false);
const items = ref<BookmarkItem[]>([]);

const renamingKey = ref<string>();
const renameValue = ref('');

/** アクティブな文書の、PDF自体のしおり（アウトライン）とアプリ管理のブックマークを合わせて読み込む */
async function loadBookmarks() {
  const file = activeFile.value;
  if (!file) {
    items.value = [];
    return;
  }

  loading.value = true;
  const isPdf = getSupportedDocumentKind(file.path) === 'pdf';
  const [outlineRes, userRes] = await Promise.all([
    isPdf ? api.getPdfOutline(file) : Promise.resolve(undefined),
    api.listBookmarks(file),
  ]);

  const outlineItems: BookmarkItem[] = outlineRes?.ok
    ? outlineRes.data.map((entry, idx) => ({
        key: `pdf-${idx}`,
        title: entry.title,
        pageNumber: entry.pageNumber,
        source: 'pdf' as const,
      }))
    : [];
  const userItems: BookmarkItem[] = userRes.ok
    ? userRes.data.map((b) => ({
        key: `user-${b.id}`,
        title: b.title,
        pageNumber: b.pageNumber,
        source: 'user' as const,
        bookmarkId: b.id,
      }))
    : [];

  items.value = [...outlineItems, ...userItems];
  loading.value = false;
}

watch(activeFile, () => void loadBookmarks(), { immediate: true });

/** クリックされたブックマークのページへ、アクティブなタブをそのまま遷移させる */
function onJump(item: BookmarkItem) {
  const file = activeFile.value;
  if (!file || item.pageNumber === undefined) return;
  editorStore.openTab(file, item.pageNumber);
}

/** 現在表示中のページを対象に、新規ブックマークを登録する */
async function onAddBookmark() {
  const file = activeFile.value;
  if (!file) return;

  const page = editorStore.activeTabCurrentPage[editorStore.activeSide] ?? 1;
  const title = `${$t('explorer.bookmarks.page')} ${page}`;
  const res = await api.addBookmark(file, title, page);
  if (res.ok) await loadBookmarks();
}

/** ブックマークを削除する */
async function onDelete(item: BookmarkItem) {
  const file = activeFile.value;
  if (!file || item.bookmarkId === undefined) return;
  await api.removeBookmark(file, item.bookmarkId);
  await loadBookmarks();
}

function startRename(item: BookmarkItem) {
  renamingKey.value = item.key;
  renameValue.value = item.title;
}

function cancelRename() {
  renamingKey.value = undefined;
}

/** 入力内容をもとに実際の改名を実行する */
async function confirmRename(item: BookmarkItem) {
  if (renamingKey.value !== item.key) return;
  renamingKey.value = undefined;

  const file = activeFile.value;
  const newTitle = renameValue.value.trim();
  if (!file || item.bookmarkId === undefined || newTitle === '' || newTitle === item.title) return;

  await api.renameBookmark(file, item.bookmarkId, newTitle);
  await loadBookmarks();
}
</script>

<style scoped lang="scss">
.explorer-bookmarks-panel {
  max-height: 240px;
  overflow-y: auto;
}
</style>
