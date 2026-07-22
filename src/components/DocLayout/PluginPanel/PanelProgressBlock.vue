<template>
  <div class="q-pa-sm">
    <div class="text-caption q-mb-xs">{{ block.label || $t('plugins.panel.running') }}</div>
    <q-linear-progress
      :value="block.percent !== null ? block.percent / 100 : undefined"
      :indeterminate="block.percent === null"
      color="primary"
      size="8px"
      rounded
    />
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

interface Prop {
  block: { kind: 'progress'; label: string; percent: number | null };
}
defineProps<Prop>();

const { t: $t } = useI18n();
</script>
