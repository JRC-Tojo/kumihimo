<template>
  <div class="settings-item-row">
    <div class="settings-item-info">
      <div class="settings-item-title">{{ title }}</div>
      <div v-if="description" class="settings-item-description">{{ description }}</div>
    </div>
    <div class="settings-item-control">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
interface Prop {
  title: string;
  description?: string;
}
defineProps<Prop>();
</script>

<style scoped lang="scss">
.settings-item-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1.5rem;
  padding: 1rem 0;
  border-bottom: 1px solid $grey-3;

  &:last-child {
    border-bottom: none;
  }

  .settings-item-info {
    flex: 1 1 auto;
    min-width: 0;

    .settings-item-title {
      font-weight: 600;
      font-size: 0.95rem;
    }

    .settings-item-description {
      font-size: 0.82rem;
      color: $grey-7;
      margin-top: 0.25rem;
    }
  }

  .settings-item-control {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    min-width: 180px;
  }
}

.body--dark .settings-item-row {
  border-bottom-color: $grey-8;

  .settings-item-description {
    color: $grey-5;
  }
}
</style>
