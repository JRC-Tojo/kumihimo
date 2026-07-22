<template>
  <q-bar class="document-footer">
    <!-- 左側は空（ページネーションを見た目上中央に配置するための余白列） -->
    <div class="footer-spacer" />

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
      <q-btn flat dense icon="zoom_out" @click="onZoomOut()" :disable="zoomLevel === 20" />
      <input
        v-model.number="zoomInputValue"
        type="number"
        class="zoom-input"
        @blur="onZoomInputBlur"
        @keyup.enter="onZoomInputEnter"
      />
      <span class="zoom-label">%</span>
      <q-btn flat dense icon="zoom_in" @click="onZoomIn()" :disable="zoomLevel === 800" />
      <q-slider
        v-model="zoomLevel"
        @update:model-value="(newVal) => (zoomInputValue = String(newVal))"
        :min="20"
        :max="800"
        :step="5"
        class="zoom-slider"
      />
    </div>
  </q-bar>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

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

function onZoomInputEnter() {
  const parsed = Number(zoomInputValue.value);
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

  .footer-spacer {
    min-width: 0;
  }

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

    .zoom-label {
      font-size: 0.85rem;
      font-weight: 600;
      color: $grey-8;
      white-space: nowrap;
      min-width: 20px;
    }

    .zoom-slider {
      width: 120px;
      margin: 0 0.5rem;

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
