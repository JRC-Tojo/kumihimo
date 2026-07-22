<template>
  <div class="q-pa-sm text-body2">{{ block.text }}</div>
</template>

<script setup lang="ts">
interface Prop {
  block: { kind: 'text'; text: string };
}
defineProps<Prop>();
</script>
