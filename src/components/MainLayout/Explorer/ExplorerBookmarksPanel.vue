<template>
  <div class="explorer-bookmarks-panel">
    <div v-if="bookmarks.length === 0" class="q-pa-md text-center text-grey">
      {{ $t('explorer.bookmarks.noBookmarks') }}
    </div>
    <q-list v-else>
      <!-- TODO: ブックマークにファイル参照が実装されたら、該当ページへの遷移を有効にしてclickableに戻す -->
      <q-item v-for="bookmark in bookmarks" :key="bookmark.id">
        <q-item-section avatar>
          <q-icon name="bookmark" color="amber" />
        </q-item-section>
        <q-item-section>
          <q-item-label>{{ bookmark.label }}</q-item-label>
          <q-item-label caption
            >{{ $t('explorer.bookmarks.page') }} {{ bookmark.pageNumber }}</q-item-label
          >
        </q-item-section>
      </q-item>
    </q-list>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface Bookmark {
  id: string;
  pageNumber: number;
  label: string;
}

// TODO: ブックマークはバックエンドから取得する
const bookmarks = computed<Bookmark[]>(() => []);
</script>

<style scoped lang="scss">
.explorer-bookmarks-panel {
  max-height: 240px;
  overflow-y: auto;
}
</style>
