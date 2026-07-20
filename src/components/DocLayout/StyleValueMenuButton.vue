<template>
  <q-btn dense flat no-caps class="style-value-btn">
    <span class="style-value-text">{{ displayText }}</span>
    <q-menu anchor="bottom middle" self="top middle">
      <div class="style-value-menu q-pa-md">
        <q-slider v-model="modelValue" :min="min" :max="max" :step="step" label color="primary" />
      </div>
    </q-menu>
    <q-tooltip>{{ tooltip }}</q-tooltip>
  </q-btn>
</template>

<script setup lang="ts">
/**
 * 数値スタイル項目（線幅・不透明度等）用の、コンパクトなポップアップスライダーボタン
 *
 * Illustrator/Affinity的な操作盤を意識し、常時展開されたスライダーではなく、
 * 現在値をテキストで示すボタンをクリックした時だけスライダーをポップアップ表示する
 */
import { computed } from 'vue';

interface Props {
  min: number;
  max: number;
  step: number;
  tooltip: string;
  format: (value: number) => string;
}
const props = defineProps<Props>();

const modelValue = defineModel<number | undefined>({ required: true });

const displayText = computed(() => props.format(modelValue.value ?? props.min));
</script>

<style scoped lang="scss">
.style-value-btn {
  min-height: 24px;
  padding: 0 0.4rem;
}

.style-value-text {
  font-size: 0.75rem;
  white-space: nowrap;
}

.style-value-menu {
  width: 180px;
}
</style>
