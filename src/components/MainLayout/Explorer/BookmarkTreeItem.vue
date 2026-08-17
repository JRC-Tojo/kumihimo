<template>
  <div class="bookmark-tree-item">
    <div class="bookmark-row" @click="onRowClick" @contextmenu.prevent="showMenu = true">
      <q-icon
        v-if="node.children.length > 0"
        :name="expanded ? 'expand_more' : 'chevron_right'"
        size="18px"
        @click.stop="expanded = !expanded"
      />
      <span v-else class="chevron-spacer" />
      <q-icon name="bookmark" color="amber" size="18px" />
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
      <template v-else>
        <p class="q-ma-none bookmark-title">{{ node.title }}</p>
        <span class="bookmark-page">{{ $t('explorer.bookmarks.page') }} {{ node.pageNumber }}</span>
      </template>

      <q-menu context-menu v-model="showMenu" @hide="onMenuHide">
        <q-list dense style="min-width: 170px">
          <q-item v-close-popup clickable @click="onAddChild">
            <q-item-section>{{ $t('explorer.bookmarks.addChild') }}</q-item-section>
          </q-item>
          <q-separator />
          <q-item v-close-popup clickable @click="requestRename">
            <q-item-section>{{ $t('explorer.rename') }}</q-item-section>
          </q-item>
          <q-item v-close-popup clickable @click="onDelete">
            <q-item-section class="text-negative">{{ $t('explorer.delete') }}</q-item-section>
          </q-item>
        </q-list>
      </q-menu>
    </div>

    <div v-if="expanded && node.children.length > 0" class="bookmark-tree-children">
      <BookmarkTreeItem
        v-for="child in node.children"
        :key="child.id"
        :file="file"
        :node="child"
        :all-bookmarks="allBookmarks"
        @reload="emit('reload')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import { useBackendApi } from 'src/apis/backendApi';
import { useEditorStore } from 'src/stores/editorStore';
import type { ContainerElementFile } from 'src/models/container';
import type { BookmarkInfo } from 'src/models/relational/fileSchema';
import type { BookmarkNode } from 'src/utils/document/bookmarkTree';
import { collectDescendantIds } from 'src/utils/document/bookmarkTree';
import { confirmDialog } from 'src/components/Dialog/confirmDialog';

interface Prop {
  file: ContainerElementFile;
  node: BookmarkNode;
  /** カスケード削除の子孫判定に使う、同一文書の全ブックマーク（フラット一覧） */
  allBookmarks: BookmarkInfo[];
}
const prop = defineProps<Prop>();
const emit = defineEmits<{ reload: [] }>();

const { t: $t } = useI18n();
const $q = useQuasar();
const api = useBackendApi();
const editorStore = useEditorStore();

const expanded = ref(true);
const showMenu = ref(false);
const isRenaming = ref(false);
const renameValue = ref('');
const pendingRename = ref(false);

/** ブックマークをクリックした際、そのページ（アノテーション位置があればそこ）へジャンプする */
async function onRowClick() {
  if (isRenaming.value) return;

  if (prop.node.annotationId) {
    const pageRes = await api.getAnnotationPageNumber(prop.node.annotationId);
    const page = pageRes.ok ? pageRes.data : prop.node.pageNumber;
    editorStore.openTab(prop.file, page, prop.node.annotationId);
    return;
  }
  editorStore.openTab(prop.file, prop.node.pageNumber);
}

/** 現在表示中のページを対象に、このブックマークの子要素として新規ブックマークを登録する */
async function onAddChild() {
  const page = editorStore.activeTabCurrentPage[editorStore.activeSide] ?? 1;
  const title = `${$t('explorer.bookmarks.page')} ${page}`;
  const res = await api.addBookmark(prop.file, title, page, { parentId: prop.node.id });
  if (res.ok) emit('reload');
}

/** 子孫が存在する場合のみ確認ダイアログを出してから削除する（カスケード削除） */
async function onDelete() {
  const hasDescendants = collectDescendantIds(prop.allBookmarks, prop.node.id).length > 0;
  if (hasDescendants) {
    const ok = await confirmDialog({
      title: $t('explorer.delete'),
      message: $t('explorer.bookmarks.deleteConfirmWithChildren'),
      severity: 'negative',
    });
    if (!ok) return;
  }

  const res = await api.removeBookmark(prop.file, prop.node.id);
  if (!res.ok) {
    console.error(res.error);
    $q.notify({ type: 'negative', message: $t('explorer.bookmarks.operationFailed') });
    return;
  }
  emit('reload');
}

/**
 * 名前変更の予約のみ行う（メニュー項目クリック時点ではまだ入力欄を出さない）
 *
 * メニューが閉じきる前にautofocusすると、メニュー側にフォーカスを奪われて即座に
 * `blur`（=`confirmRename`即時実行）が発生してしまうため、`@hide`後に入力欄を表示する
 */
function requestRename() {
  pendingRename.value = true;
}

function onMenuHide() {
  if (!pendingRename.value) return;
  pendingRename.value = false;
  renameValue.value = prop.node.title;
  isRenaming.value = true;
}

function cancelRename() {
  isRenaming.value = false;
}

async function confirmRename() {
  if (!isRenaming.value) return;
  isRenaming.value = false;

  const newTitle = renameValue.value.trim();
  if (newTitle === '' || newTitle === prop.node.title) return;

  const res = await api.renameBookmark(prop.file, prop.node.id, newTitle);
  if (!res.ok) {
    console.error(res.error);
    $q.notify({ type: 'negative', message: $t('explorer.bookmarks.operationFailed') });
    return;
  }
  emit('reload');
}
</script>

<style lang="scss" scoped>
@use 'sass:color';

.bookmark-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 2px 4px;
  cursor: pointer;
  border-radius: 2px;

  &:hover {
    background: color.adjust(gray, $alpha: -0.5);
  }

  .chevron-spacer {
    width: 18px;
    flex-shrink: 0;
  }

  .bookmark-title {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .bookmark-page {
    flex-shrink: 0;
    font-size: 0.75rem;
    color: $grey-6;
  }

  .rename-input {
    flex: 1;
    min-width: 0;
  }
}

.bookmark-tree-children {
  margin-left: 12px;
  padding-left: 3px;
  border-left: 1px solid rgba(128, 128, 128, 0.3);
}
</style>
