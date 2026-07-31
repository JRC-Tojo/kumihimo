<template>
  <q-bar
    class="document-footer"
    :class="{ 'document-footer--relational': editorStore.relationalPendingId !== undefined }"
  >
    <!-- 左側：ステータスメッセージ領域。関係性モードの待機メッセージ等、今後も様々な操作が
         任意のメッセージをここへ投稿することを想定する（中身が無ければ余白列として機能する） -->
    <div class="footer-section footer-status">
      <span v-if="editorStore.currentStatusMessage" class="status-message">
        {{ editorStore.currentStatusMessage }}
      </span>
      <q-btn
        v-if="editorStore.relationalPendingId !== undefined"
        flat
        dense
        round
        size="sm"
        icon="close"
        :title="$t('pdfEditor.tools.relational.cancel')"
        @click="editorStore.cancelRelationalPending()"
      />
    </div>

    <!-- 中央：ページネーション -->
    <div class="footer-section footer-pagination">
      <q-btn flat dense icon="first_page" @click="onGoToFirstPage()" :disable="currentPage === 1" />
      <q-btn
        flat
        dense
        icon="navigate_before"
        @click="onPreviousPage()"
        :disable="currentPage === 1"
      />
      <input
        v-model.number="pageInputValue"
        type="number"
        class="page-input"
        @blur="onPageInputBlur"
        @keyup.enter="onPageInputEnter"
      />
      <span class="page-info">/ {{ totalPageCount }}</span>
      <q-btn
        flat
        dense
        icon="navigate_next"
        @click="onNextPage()"
        :disable="currentPage === totalPageCount"
      />
      <q-btn
        flat
        dense
        icon="last_page"
        @click="onGoToLastPage()"
        :disable="currentPage === totalPageCount"
      />
    </div>

    <!-- 右側：ズームコントロール -->
    <div class="footer-section footer-zoom">
      <q-btn
        flat
        dense
        icon="fit_screen"
        :title="$t('pdfEditor.footer.zoom.fitPage')"
        @click="onFitPage()"
      />
      <q-btn
        flat
        dense
        icon="width_full"
        :title="$t('pdfEditor.footer.zoom.fitWidth')"
        @click="onFitWidth()"
      />
      <q-btn flat dense icon="zoom_out" @click="onZoomOut()" :disable="zoomLevel === MIN_ZOOM" />
      <q-slider v-model="zoomLevel" :min="MIN_ZOOM" :max="MAX_ZOOM" :step="5" class="zoom-slider" />
      <q-btn flat dense icon="zoom_in" @click="onZoomIn()" :disable="zoomLevel === MAX_ZOOM" />
      <q-input
        v-model="zoomInputValue"
        type="number"
        dense
        borderless
        suffix="%"
        :min="MIN_ZOOM"
        :max="MAX_ZOOM"
        step="5"
        class="zoom-input"
        :input-style="{ textAlign: 'right' }"
        @blur="onZoomInputBlur"
        @keyup.enter="onZoomInputEnter"
      />
    </div>
  </q-bar>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useEditorStore } from 'src/stores/editorStore';
import { MAX_ZOOM, MIN_ZOOM } from 'src/components/Viewer/zoomSteps';

const editorStore = useEditorStore();

interface Prop {
  totalPageCount: number;
  scale: number;
  onGoToFirstPage: () => void;
  onPreviousPage: () => void;
  onGoToPage: (page: number) => void;
  onNextPage: () => void;
  onGoToLastPage: () => void;
  onSetZoom: (level: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  onFitPage: () => void;
}
const props = defineProps<Prop>();

const currentPage = defineModel<number>('currentPage', { required: true });
const zoomLevel = defineModel<number>('zoomLevel', { required: true });

// ページ入力用の一時 state
const pageInputValue = ref<string>(String(currentPage.value));
// ズーム入力用の一時 state
const zoomInputValue = ref<string>(String(zoomLevel.value));

function onPageInputBlur() {
  pageInputValue.value = String(currentPage.value);
}

function onPageInputEnter() {
  const parsed = Math.floor(Number(pageInputValue.value));
  props.onGoToPage(parsed);
}

function onZoomInputBlur() {
  zoomInputValue.value = String(zoomLevel.value);
}

/**
 * ズーム数値入力の確定処理。`abc`のような非数値入力は`Number()`で`NaN`になり、
 * そのまま`clampZoom`（`Math.max`/`Math.min`）へ渡すと結果もNaNになって
 * ズームレベルが壊れてしまうため、有限な数値かどうかを確認してから反映する。
 * 不正な入力は反映せず、表示だけ現在のズームレベルへ戻す
 */
function onZoomInputEnter() {
  const parsed = Number(zoomInputValue.value);
  if (!Number.isFinite(parsed)) {
    zoomInputValue.value = String(zoomLevel.value);
    return;
  }
  props.onSetZoom(parsed);
}

watch(currentPage, (newPage) => {
  pageInputValue.value = String(newPage);
});

watch(zoomLevel, (newZoomLevel) => {
  zoomInputValue.value = String(newZoomLevel);
});
</script>

<style scoped lang="scss">
@use 'sass:color';

.document-footer {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 1rem;
  background-color: $grey-1;
  border-top: 1px solid $grey-3;
  padding: 0 1rem;
  // メインツール・サブツールバーと高さを揃える（以前は64px固定で footer だけ高かった）
  min-height: 44px;
  box-shadow: 0 -1px 3px rgba(0, 0, 0, 0.08);
  overflow-x: auto;
  transition: background-color 0.2s ease;

  .footer-section {
    display: flex;
    align-items: center;
    gap: 0.75rem;

    .section-label {
      font-size: 0.85rem;
      font-weight: 600;
      color: $grey-8;
      white-space: nowrap;
    }
  }

  .footer-status {
    min-width: 0;

    .status-message {
      font-size: 0.85rem;
      font-weight: 500;
      color: $primary;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }

  // 関係性登録モードがONの間、フッター全体の色を変えてモード状態を示す
  &.document-footer--relational {
    background-color: rgba($primary, 0.12);
  }

  .footer-pagination {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    justify-self: center;

    .page-input {
      width: 50px;
      padding: 0.5rem 0.75rem;
      border: 1px solid $grey-4;
      border-radius: 6px;
      text-align: center;
      font-size: 0.9rem;
      font-weight: 500;
      background: white;
      transition: all 0.2s ease;

      &:focus {
        outline: none;
        border-color: $primary;
        box-shadow: 0 0 0 2px rgba($primary, 0.1);
        background: white;
      }

      &::-webkit-outer-spin-button,
      &::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }

      &[type='number'] {
        appearance: textfield;
        -moz-appearance: textfield;
      }
    }

    .page-info {
      font-size: 0.9rem;
      color: $grey-7;
      white-space: nowrap;
      font-weight: 500;
    }
  }

  .footer-tile-mode {
    :deep(.q-btn-toggle__container) {
      gap: 0.25rem;
      background: $grey-2;
      border-radius: 6px;
      padding: 2px;

      .q-btn {
        border-radius: 4px;
        font-size: 0.75rem;
        font-weight: 600;

        &.q-btn--active {
          background: white;
          color: $primary;
        }
      }
    }
  }

  .footer-zoom {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    justify-self: end;

    .zoom-input {
      width: 50px;
      background: transparent !important;
    }

    .zoom-slider {
      width: 120px;

      :deep(.q-slider) {
        color: $primary;
      }
    }
  }
}

.body--dark .document-footer {
  background-color: color.adjust($dark, $lightness: -5%);
  border-top-color: $grey-8;
  box-shadow: 0 -1px 3px rgba(0, 0, 0, 0.3);

  &.document-footer--relational {
    background-color: rgba($primary, 0.2);
  }

  .footer-section {
    .section-label {
      color: $grey-3;
    }
  }

  .footer-pagination {
    .page-input {
      background: $grey-8;
      border-color: $grey-7;
      color: $grey-2;

      &:focus {
        border-color: $primary;
        box-shadow: 0 0 0 2px rgba($primary, 0.2);
        background: color.adjust($grey-8, $lightness: -5%);
      }
    }

    .page-info {
      color: $grey-4;
    }
  }

  .footer-tile-mode {
    :deep(.q-btn-toggle__container) {
      background: $grey-8;

      .q-btn {
        color: $grey-4;

        &.q-btn--active {
          background: color.adjust($dark, $lightness: -3%);
          color: $primary;
        }
      }
    }
  }

  .footer-zoom {
    .zoom-input {
      background: $grey-8;
      border-color: $grey-7;
      color: $grey-2;

      &:focus {
        border-color: $primary;
        box-shadow: 0 0 0 2px rgba($primary, 0.2);
        background: color.adjust($grey-8, $lightness: -5%);
      }
    }

    .zoom-label {
      color: $grey-3;
    }
  }
}
</style>
