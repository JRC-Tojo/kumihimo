<template>
  <q-banner v-if="block.severity === 'error'" dense class="bg-negative text-white q-ma-sm">
    {{ block.text }}
  </q-banner>
  <div v-else class="q-pa-sm text-body2">{{ block.text }}</div>
</template>

<script setup lang="ts">
interface Prop {
  block: { kind: 'text'; text: string; severity?: 'info' | 'error' | undefined };
}
defineProps<Prop>();
</script>
