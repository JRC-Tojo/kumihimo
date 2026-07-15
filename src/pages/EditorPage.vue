<template>
  <q-page class="editor-page">
    <!-- メインツールバー -->
    <q-bar class="main-toolbar text-white">
      <q-btn
        v-for="tool in editorStore.mainTools"
        :key="tool.id"
        :flat="!tool.isActive()"
        :outline="tool.isActive()"
        :disable="tool.isDisable?.() ?? false"
        dense
        :icon="tool.icon"
        :title="tool.label"
        class="toolbar-btn"
        @click="handleMainToolClick(tool)"
      />
    </q-bar>

    <!-- サブツールバー -->
    <q-bar v-if="editorStore.subTools.length > 0" class="sub-toolbar">
      <template v-for="tool in editorStore.subTools" :key="tool.id">
        <q-btn
          :flat="!tool.isActive()"
          :outline="tool.isActive()"
          :color="tool.isActive() ? 'primary' : ''"
          dense
          :icon="tool.icon"
          :title="tool.label"
          :label="tool.label"
          class="toolbar-btn-sub"
          @click="tool.onClicked()"
        />
      </template>
    </q-bar>

    <!-- ドキュメントレイアウト -->
    <div v-if="editorStore.tileMode === 'single'" class="doc-layout">
      <DocTabsPage layout-side="ul" />
    </div>
    <div v-else-if="editorStore.tileMode === 'dubble'" class="doc-layout dubble">
      <div class="ul"><DocTabsPage layout-side="ul" /></div>
      <div class="ur"><DocTabsPage layout-side="ur" /></div>
    </div>
    <div v-else-if="editorStore.tileMode === 'grid'" class="doc-layout grid">
      <div class="ul"><DocTabsPage layout-side="ul" /></div>
      <div class="ur"><DocTabsPage layout-side="ur" /></div>
      <div class="ll"><DocTabsPage layout-side="ll" /></div>
      <div class="lr"><DocTabsPage layout-side="lr" /></div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { useEditorStore } from 'src/stores/editorStore';
import DocTabsPage from './DocTabsPage.vue';
import type { IDocTool } from 'src/models/docPage';

/**
 * 文書ページコンポーネント
 * ツールバーとドキュメントレイアウトを統合
 */

const editorStore = useEditorStore();

function handleMainToolClick(tool: IDocTool) {
  editorStore.subTools = [];
  void tool.onClicked();
}
</script>

<style scoped lang="scss">
@use 'sass:color';

.editor-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 0;
  overflow: hidden;
}

.main-toolbar {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  background: linear-gradient(135deg, $primary 0%, color.adjust($primary, $lightness: -5%) 100%);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  flex-shrink: 0;

  .toolbar-btn {
    transition: all 0.2s ease;
    border-radius: 6px;

    &:hover {
      background-color: rgba(white, 0.25);
      transform: translateY(-2px);
    }

    &:active {
      transform: translateY(0);
    }
  }
}

.body--dark .main-toolbar {
  background: linear-gradient(
    135deg,
    color.adjust($primary, $lightness: -10%) 0%,
    color.adjust($primary, $lightness: -15%) 100%
  );
}

.sub-toolbar {
  display: flex;
  margin: 5px;
  border-bottom: 1px solid $grey-4;
  flex-wrap: wrap;
  background: $grey-1;
  flex-shrink: 0;

  .toolbar-btn-sub {
    font-size: 0.85rem;
    transition: all 0.2s ease;
    border-radius: 6px;

    &:hover {
      background-color: rgba($primary, 0.15);
      transform: translateY(-1px);
    }

    &:active {
      transform: translateY(0);
    }
  }
}

.body--dark .sub-toolbar {
  background: $dark;
  border-bottom-color: $grey-8;

  .toolbar-btn-sub {
    &:hover {
      background-color: rgba($primary, 0.25);
    }
  }
}

.doc-layout {
  flex: 1 1 0;
  padding: 2px;
  height: 100%;
  width: 100%;
  max-width: 100vw;
  overflow: hidden;
}

.dubble {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  grid-template-areas: 'ul ur';
  gap: 2px;

  .ul {
    grid-area: ul;
    overflow: hidden;
  }
  .ur {
    grid-area: ur;
    overflow: hidden;
  }
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  grid-template-rows: repeat(2, 50%);
  grid-template-areas:
    'ul ur'
    'll lr';
  gap: 2px;

  .ul {
    grid-area: ul;
    overflow: hidden;
  }
  .ur {
    grid-area: ur;
    overflow: hidden;
  }
  .ll {
    grid-area: ll;
    overflow: hidden;
  }
  .lr {
    grid-area: lr;
    overflow: hidden;
  }
}
</style>
