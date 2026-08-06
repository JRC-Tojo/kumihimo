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
    <div v-else-if="tree.length === 0" class="q-pa-md text-center text-grey">
      {{ $t('explorer.bookmarks.noBookmarks') }}
    </div>
    <div v-else>
      <BookmarkTreeItem
        v-for="node in tree"
        :key="node.id"
        :file="activeFile!"
        :node="node"
        :all-bookmarks="bookmarks"
        @reload="loadBookmarks"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useBackendApi } from 'src/apis/backendApi';
import { useEditorStore } from 'src/stores/editorStore';
import type { BookmarkInfo } from 'src/models/relational/fileSchema';
import { buildBookmarkTree } from 'src/utils/document/bookmarkTree';
import BookmarkTreeItem from './BookmarkTreeItem.vue';

const { t: $t } = useI18n();
const api = useBackendApi();
const editorStore = useEditorStore();

const activeFile = computed(() => editorStore.getActiveTab(editorStore.activeSide));
// アノテーション右クリック等、このパネル以外からのブックマーク変更を検知するためのリビジョン
const bookmarksRevision = computed(() => {
  const file = activeFile.value;
  return file ? editorStore.getBookmarksRevision(file) : undefined;
});

const loading = ref(false);
const bookmarks = ref<BookmarkInfo[]>([]);
const tree = computed(() => buildBookmarkTree(bookmarks.value));

/**
 * アクティブな文書のブックマーク一覧を読み込む
 *
 * PDF自体に埋め込まれたしおり（アウトライン）は文書読み込み時に自動でここへ取り込まれる
 * （`documentService.loadConfig`側の処理）ため、ここでは区別なく一覧を取得するだけでよい
 */
async function loadBookmarks() {
  const file = activeFile.value;
  if (!file) {
    bookmarks.value = [];
    return;
  }

  loading.value = true;
  const res = await api.listBookmarks(file);
  bookmarks.value = res.ok ? res.data : [];
  loading.value = false;
}

watch([activeFile, bookmarksRevision], () => void loadBookmarks(), { immediate: true });

/** 現在表示中のページを対象に、新規ブックマークを登録する */
async function onAddBookmark() {
  const file = activeFile.value;
  if (!file) return;

  const page = editorStore.activeTabCurrentPage[editorStore.activeSide] ?? 1;
  const title = `${$t('explorer.bookmarks.page')} ${page}`;
  const res = await api.addBookmark(file, title, page);
  if (res.ok) await loadBookmarks();
}
</script>

<style scoped lang="scss">
.explorer-bookmarks-panel {
  max-height: 240px;
  overflow-y: auto;
}
</style>
