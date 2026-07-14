<template>
  <div class="tab-item" :class="{ active }" @click="emit('select')">
    <div class="tab-content">
      <q-icon :name="icon" class="tab-icon" />
      <span class="tab-title">{{ title }}</span>
      <span v-if="hasUnsavedChanges" class="unsaved-dot" :title="$t('explorer.unsavedChanges')" />
    </div>
    <q-btn
      flat
      dense
      round
      icon="close"
      size="xs"
      class="tab-close-btn"
      @click.stop="emit('close')"
    />
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

interface Prop {
  icon: string;
  title: string;
  active: boolean;
  hasUnsavedChanges?: boolean;
}
withDefaults(defineProps<Prop>(), { hasUnsavedChanges: false });
const emit = defineEmits<{ select: []; close: [] }>();

const { t: $t } = useI18n();
</script>

<style scoped lang="scss">
@use 'sass:color';

.tab-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 12px;
  min-width: 120px;
  max-width: 200px;
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

  &:hover {
    background: $grey-3;

    .tab-close-btn {
      opacity: 1;
    }
  }

  &.active {
    background: white;
    border-top-color: $primary;
    color: $primary;
    box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.08);

    .tab-content {
      .tab-icon {
        color: $primary;
      }

      .tab-title {
        color: $primary;
        font-weight: 600;
      }
    }

    .tab-close-btn {
      opacity: 1;
      color: $primary;
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
    border-top-color: $primary;

    .tab-content {
      .tab-icon {
        color: $primary;
      }

      .tab-title {
        color: $primary;
      }
    }

    .tab-close-btn {
      color: $primary;
    }
  }
}
</style>
