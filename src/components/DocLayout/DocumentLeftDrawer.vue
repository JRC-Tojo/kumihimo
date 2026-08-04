<template>
  <div v-show="drawerOpen" class="document-left-drawer">
    <!-- サムネイル一覧 -->
    <q-separator />
    <div class="drawer-section q-pa-md">
      <h6 class="q-my-none q-mb-md">{{ $t('pdfEditor.leftDrawer.thumbnail.title') }}</h6>
      <div class="thumbnails-list">
        <div
          v-for="page in totalPageCount"
          :key="page"
          :class="['thumbnail-item', { active: page === currentPage }]"
          @click="onGoToPage(page)"
        >
          <img
            v-if="totalPageCount === thumnails.length"
            :src="thumnails[page - 1]"
            :alt="`Page ${page}`"
          />
          <q-spinner v-else color="primary" class="fit q-pa-md" />
          <div class="page-number">{{ page }}</div>
        </div>
      </div>
    </div>

    <!-- ブックマーク -->
    <q-separator />
    <div class="drawer-section q-pa-md">
      <h6 class="q-my-none q-mb-md">{{ $t('pdfEditor.leftDrawer.bookmark.title') }}</h6>
      <div v-if="bookmarks.length === 0" class="q-pa-md text-center text-grey">
        {{ $t('pdfEditor.leftDrawer.bookmark.noBookmarks') }}
      </div>
      <q-list v-else>
        <q-item
          v-for="bookmark in bookmarks"
          :key="bookmark.id"
          clickable
          @click="onGoToPage(bookmark.pageNumber)"
        >
          <q-item-section avatar>
            <q-icon name="bookmark" color="amber" />
          </q-item-section>
          <q-item-section>
            <q-item-label>{{ bookmark.label }}</q-item-label>
            <q-item-label caption
              >{{ $t('pdfEditor.leftDrawer.bookmark.page') }}
              {{ bookmark.pageNumber }}</q-item-label
            >
          </q-item-section>
        </q-item>
      </q-list>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface Prop {
  totalPageCount: number;
  currentPage: number;
  thumnails: string[];
  onGoToPage: (page: number) => void;
}
defineProps<Prop>();

const drawerOpen = defineModel<boolean>('drawerOpen', { required: true });

interface Bookmark {
  id: string;
  pageNumber: number;
  label: string;
}

// TODO: ブックマークはバックエンドから取得する
const bookmarks = computed<Bookmark[]>(() => []);
</script>

<style scoped lang="scss">
@use 'sass:color';

.document-left-drawer {
  width: 280px;
  height: 100%;
  background: white;
  border-right: 1px solid $grey-3;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
  flex-shrink: 0;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: $grey-2;
  }

  &::-webkit-scrollbar-thumb {
    background: $grey-4;
    border-radius: 3px;

    &:hover {
      background: $grey-5;
    }
  }

  .drawer-section {
    h6 {
      font-weight: 600;
      font-size: 0.95rem;
      color: var(--q-primary);
    }
  }

  .document-info {
    .info-item {
      display: flex;
      justify-content: space-between;
      margin-bottom: 0.75rem;
      font-size: 0.9rem;

      .label {
        font-weight: 500;
        color: $grey-8;
      }

      .value {
        color: $grey-7;
        word-break: break-word;
        max-width: 60%;
        text-align: left;
      }
    }
  }

  .thumbnails-list {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.75rem;

    .thumbnail-item {
      cursor: pointer;
      border: 2px solid $grey-3;
      border-radius: 6px;
      transition: all 0.2s ease;
      overflow: hidden;
      aspect-ratio: 3 / 4;

      &:hover {
        border-color: var(--q-primary);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
        transform: translateY(-2px);
      }

      &.active {
        border-color: var(--q-primary);
        background-color: color-mix(in srgb, var(--q-primary) 55%, white);
        box-shadow: 0 0 0 3px rgba(var(--q-primary-rgb), 0.2);
      }

      img {
        width: 100%;
        height: calc(100% - 24px);
        object-fit: cover;
      }

      .page-number {
        padding: 0.5rem;
        text-align: center;
        font-size: 0.75rem;
        background-color: $grey-2;
        color: $grey-7;
        font-weight: 600;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
    }
  }
}

.body--dark .document-left-drawer {
  background: $dark;
  border-right-color: $grey-8;

  &::-webkit-scrollbar-track {
    background: $grey-8;
  }

  &::-webkit-scrollbar-thumb {
    background: $grey-7;

    &:hover {
      background: $grey-6;
    }
  }

  .drawer-section {
    h6 {
      color: var(--q-primary);
    }
  }

  .document-info {
    .info-item {
      .label {
        color: $grey-3;
      }

      .value {
        color: $grey-4;
      }
    }
  }

  .thumbnails-list {
    .thumbnail-item {
      border-color: $grey-7;

      &:hover {
        border-color: var(--q-primary);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      }

      &.active {
        border-color: var(--q-primary);
        background-color: color-mix(in srgb, var(--q-primary) 75%, white);
        box-shadow: 0 0 0 3px rgba(var(--q-primary-rgb), 0.3);
      }

      .page-number {
        background-color: $grey-8;
        color: $grey-4;
      }
    }
  }
}
</style>
