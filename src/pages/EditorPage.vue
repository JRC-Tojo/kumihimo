<template>
  <q-page class="editor-page row">
    <div class="main-toolbar">
      <q-btn
        v-for="tool in editorStore.mainTools"
        :key="tool.id"
        flat
        :disable="tool.isDisable?.() ?? false"
        dense
        :icon="tool.icon"
        :title="tool.label"
        class="toolbar-btn"
        :class="{ 'toolbar-btn--active': tool.isActive() }"
        @click="handleMainToolClick(tool)"
        @dblclick="handleMainToolDoubleClick(tool)"
      >
        <q-menu v-if="!tool.noMenu" anchor="center right" self="center left" auto-close>
          <div class="annotation-type-menu q-pa-sm">
            <AnnotationPresetBar
              v-if="editorStore.activeAnnotationType"
              class="preset-bar-wrapper"
            />
            <q-btn
              v-for="subtool in editorStore.subTools"
              :key="subtool.id"
              :flat="!subtool.isActive()"
              :outline="subtool.isActive()"
              :disable="subtool.isDisable?.() ?? false"
              dense
              :icon="subtool.icon"
              :label="subtool.label"
              class="toolbar-btn"
              @click="subtool.onClicked"
            />
          </div>
        </q-menu>
      </q-btn>
    </div>
    <div class="col" style="display: flex; flex-direction: column">
      <!--
        SubTools領域: MainToolsと同じ高さで常駐させ、内容の有無に関わらずレイアウトが
        伸縮しないようにする。関係性/重ね順/保存/タイル等の汎用ツール、または
        アノテーションプリセット一覧＋スタイルパネル（描画スタイルモード・選択編集モード）を
        この領域内で出し分ける
      -->
      <q-bar class="sub-toolbar">
        <AnnotationPresetBar
          v-if="stylePanelMode !== 'none' && stylePanelEffectiveType"
          class="preset-bar-wrapper"
        />
        <AnnotationStylePanel class="style-panel-wrapper" />
        <AnnotationPositionSizeBtn />
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
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useEditorStore, SETTINGS_TAB_KEY } from 'src/stores/editorStore';
import DocTabsPage from './DocTabsPage.vue';
import AnnotationPresetBar from 'src/components/DocLayout/AnnotationPresetBar.vue';
import AnnotationStylePanel from 'src/components/DocLayout/AnnotationStylePanel.vue';
import type { IDocTool } from 'src/models/docPage';
import AnnotationPositionSizeBtn from 'src/components/DocLayout/AnnotationPositionSizeBtn.vue';
import { useAnnotationStylePanel } from 'src/components/DocLayout/composables/useAnnotationStylePanel';
import { callEditorTools, firstPresetStyleForType } from 'src/stores/editorTools';
import { getSupportedDocumentKind } from 'src/utils/document/supportedTypes';
import type { DrawingAnnotationType } from 'src/models/docPage';

/**
 * 文書ページコンポーネント
 * ツールバーとドキュメントレイアウトを統合
 */

const { t } = useI18n();
const editorStore = useEditorStore();
// 常駐サブツール行にプリセットバーを表示するかどうかの判定にのみ使う
// （AnnotationStylePanel自身も内部で同じcomposableを呼ぶが、Piniaストアを参照するだけなので二重利用しても問題ない）
const { mode: stylePanelMode, effectiveType: stylePanelEffectiveType } = useAnnotationStylePanel();

// アクティブなペイン・タブの種別（PDF文書のみメインツールを持つ）
const activeTabKind = computed<'settings' | 'pdf' | 'text' | 'unsupported' | 'none'>(() => {
  if (editorStore.activeTabPaths[editorStore.activeSide] === SETTINGS_TAB_KEY) return 'settings';
  const file = editorStore.getActiveTab(editorStore.activeSide);
  if (!file) return 'none';
  return getSupportedDocumentKind(file.path);
});

// アクティブタブの種別に応じてメインツールを注入・撤去する。
// PDF文書タブ以外（設定・テキスト・非対応ファイル・未選択）ではメインツールバーを空にする
let mainToolsRequestId = 0;
watch(
  activeTabKind,
  async (kind) => {
    const requestId = ++mainToolsRequestId;
    const tools = kind === 'pdf' ? await callEditorTools(t) : [];
    // 待機中により新しいタブ切り替えが発生していた場合、古い結果で上書きしない
    if (requestId !== mainToolsRequestId) return;
    editorStore.setMainTools(tools);
  },
  { immediate: true },
);

/** メインツールのクリックを処理する。選択中のスタイルパネル・連続描画モードを一旦リセットしたうえで、ツール本来の処理を実行する */
function handleMainToolClick(tool: IDocTool) {
  editorStore.subTools = [];
  // アノテーション種別以外のツールをクリックした場合、プリセットバー・スタイルパネルの
  // 描画スタイルモードを終了する（tool.onClicked内で改めてtypeがセットされる場合は再度上書きされる）
  editorStore.activeAnnotationType = undefined;
  // メインツールを明示的に選び直した場合は、プリセットのダブルクリックによる
  // 連続描画モード（stickyDrawMode）も一旦解除する
  editorStore.stickyDrawMode = false;
  void tool.onClicked();
}

/** メインツールのIDから、対応するアノテーション種別ボタンであればその種別を返す（`annotation-${type}`形式のみ対象） */
function mainToolAnnotationType(tool: IDocTool): DrawingAnnotationType | undefined {
  const prefix = 'annotation-';
  if (!tool.id.startsWith(prefix)) return undefined;
  return tool.id.slice(prefix.length) as DrawingAnnotationType;
}

/**
 * メインツール（アノテーション種別ボタン）のダブルクリックを処理する。
 * プリセットバー先頭のプリセットをダブルクリックした場合と挙動を揃え、
 * 現在のプリセット適用状況に関わらず先頭プリセットを強制適用したうえで連続描画モードにする
 */
function handleMainToolDoubleClick(tool: IDocTool) {
  const type = mainToolAnnotationType(tool);
  if (type === undefined) return;
  handleMainToolClick(tool);
  const style = firstPresetStyleForType(type);
  if (style !== undefined) editorStore.currentAnnotationStyle = style;
  editorStore.stickyDrawMode = true;
}
</script>

<style scoped lang="scss">
.editor-page {
  height: 100%;
  padding: 0;
  overflow: hidden;
}

.main-toolbar {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex-wrap: wrap;
  min-height: 44px;
  // 通常背景と同系色にし、選択中ボタンだけプライマリ色で目立たせる（視認性重視）
  background: $grey-2;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  flex-shrink: 0;

  .toolbar-btn {
    transition: all 0.2s ease;
    border-radius: 6px;
    color: $grey-9;

    &:hover {
      background-color: rgba($primary, 0.12);
      transform: translateY(-2px);
    }

    &:active {
      transform: translateY(0);
    }

    &.toolbar-btn--active {
      background-color: rgba($primary, 0.15);
      color: $primary;
    }
  }
}

.annotation-type-menu {
  min-width: 0;
}

.body--dark .main-toolbar {
  background: $dark;

  .toolbar-btn {
    color: $grey-3;

    &:hover {
      background-color: rgba($primary, 0.25);
    }

    &.toolbar-btn--active {
      background-color: rgba($primary, 0.3);
      color: $primary;
    }
  }
}

.sub-toolbar {
  display: flex;
  align-items: center;
  // MainToolsと同じ高さで常駐させ、中身の有無（汎用ツール／プリセット＋スタイルパネル／空）に
  // 関わらずレイアウトが伸縮しないようにする
  min-height: 44px;
  border-bottom: 1px solid $grey-4;
  flex-wrap: nowrap;
  overflow-x: auto;
  background: $grey-1;
  flex-shrink: 0;

  .toolbar-btn-sub {
    font-size: 0.85rem;
    transition: all 0.2s ease;
    border-radius: 6px;
    flex-shrink: 0;

    &:hover {
      background-color: rgba($primary, 0.15);
      transform: translateY(-1px);
    }

    &:active {
      transform: translateY(0);
    }
  }

  .preset-bar-wrapper {
    // プリセット数に関わらずスタイルパネルが画面外に押し出されないよう、
    // 一覧側に最大幅を設けたうえで横スクロールにする
    flex: 0 1 60%;
    min-width: 0;
  }

  .style-panel-wrapper {
    flex-shrink: 0;
    height: 100%;
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
