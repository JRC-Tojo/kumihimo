<template>
  <div class="q-pa-sm">
    <div class="text-caption q-mb-xs">{{ $t('plugins.panel.logSectionTitle') }}</div>
    <pre class="plugin-log">{{ block.lines.join('\n') }}</pre>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

interface Prop {
  block: { kind: 'log'; lines: string[] };
}
defineProps<Prop>();

const { t: $t } = useI18n();
</script>

<style scoped lang="scss">
.plugin-log {
  white-space: pre-wrap;
  font-size: 0.75rem;
  background: $grey-2;
  padding: 8px;
  border-radius: 4px;
  max-height: 240px;
  overflow-y: auto;
}

.body--dark .plugin-log {
  background: $grey-9;
}
</style>
