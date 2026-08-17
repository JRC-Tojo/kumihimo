<template>
  <div
    class="tab-item"
    :class="{ active, pinned }"
    @click="emit('select')"
    @contextmenu="onContextMenu"
  >
    <div class="tab-content">
      <q-icon :name="icon" class="tab-icon" />
      <span class="tab-title">{{ title }}</span>
      <span v-if="hasUnsavedChanges" class="unsaved-dot" :title="$t('explorer.unsavedChanges')" />
    </div>
    <q-icon
      v-if="pinned"
      name="push_pin"
      class="tab-pin-icon"
      size="14px"
      :title="$t('pdfEditor.tabs.unpin')"
      @click.stop="emit('unpin')"
    />
    <q-btn
      v-else
      flat
      dense
      round
      icon="close"
      size="xs"
      class="tab-close-btn"
      @click.stop="emit('close')"
    />

    <q-menu v-if="$slots.menu" context-menu v-model="showMenu">
      <slot name="menu" />
    </q-menu>
  </div>
</template>

<script setup lang="ts">
import { ref, useSlots } from 'vue';
import { useI18n } from 'vue-i18n';

interface Prop {
  icon: string;
  title: string;
  active: boolean;
  hasUnsavedChanges?: boolean;
  pinned?: boolean;
}
withDefaults(defineProps<Prop>(), { hasUnsavedChanges: false, pinned: false });
const emit = defineEmits<{ select: []; close: []; unpin: [] }>();

const { t: $t } = useI18n();
const slots = useSlots();
const showMenu = ref(false);

/** `menu`スロットを持つタブ（文書タブ）のみ、右クリックで独自メニューを開く。それ以外は既定のブラウザメニューに委ねる */
function onContextMenu(e: MouseEvent) {
  if (!slots.menu) return;
  e.preventDefault();
  showMenu.value = true;
}
</script>

<style scoped lang="scss">
@use 'sass:color';

.tab-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 12px;
  min-width: 150px;
  max-width: 200px;
  height: 100%;
  background: $grey-2;
  border-radius: 8px 8px 0 0;
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
  border-top: 3px solid transparent;

  .tab-content {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;

    .tab-icon {
      font-size: 1.1rem;
      color: $grey-7;
      flex-shrink: 0;
    }

    .tab-title {
      font-size: 0.9rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: $grey-8;
      font-weight: 500;
    }
  }

  .unsaved-dot {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: $warning;
  }

  .tab-close-btn {
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.2s ease;

    &:hover {
      background-color: rgba($negative, 0.1);
      color: $negative;
    }
  }

  .tab-pin-icon {
    flex-shrink: 0;
    color: var(--q-primary);
    cursor: pointer;
  }

  &.pinned {
    border-top-color: rgba(var(--q-primary-rgb), 0.4);
  }

  &:hover {
    background: $grey-3;

    .tab-close-btn {
      opacity: 1;
    }
  }

  &.active {
    background: white;
    border-top-color: var(--q-primary);
    color: var(--q-primary);
    box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.08);

    .tab-content {
      .tab-icon {
        color: var(--q-primary);
      }

      .tab-title {
        color: var(--q-primary);
        font-weight: 600;
      }
    }

    .tab-close-btn {
      opacity: 1;
      color: var(--q-primary);
    }
  }
}

.body--dark .tab-item {
  background: $grey-8;

  .tab-content {
    .tab-icon {
      color: $grey-5;
    }

    .tab-title {
      color: $grey-4;
    }
  }

  &:hover {
    background: $grey-7;
  }

  &.active {
    background: color.adjust($dark, $lightness: -5%);
    border-top-color: var(--q-primary);

    .tab-content {
      .tab-icon {
        color: var(--q-primary);
      }

      .tab-title {
        color: var(--q-primary);
      }
    }

    .tab-close-btn {
      color: var(--q-primary);
    }
  }
}
</style>
