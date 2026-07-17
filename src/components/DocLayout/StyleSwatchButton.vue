<template>
  <q-btn
    dense
    flat
    :ripple="false"
    class="style-swatch-btn"
    :style="{ backgroundColor: colorValue ?? '#ffffff' }"
  >
    <q-popup-proxy cover transition-show="scale" transition-hide="scale">
      <q-color v-model="colorValue" />
    </q-popup-proxy>
    <q-tooltip>{{ tooltip }}</q-tooltip>
  </q-btn>
</template>

<script setup lang="ts">
/**
 * スタイルパネル・RightDrawerで共用する、小さな色スウォッチボタン
 *
 * Illustrator/Affinity的な操作盤を意識し、常時展開されたカラーピッカーではなく、
 * クリックでポップアップ表示するコンパクトなスウォッチのみを常設する
 */
interface Props {
  tooltip: string;
}
defineProps<Props>();

const colorValue = defineModel<string | undefined>({ required: true });
</script>

<style scoped lang="scss">
.style-swatch-btn {
  width: 20px;
  height: 20px;
  min-height: 20px;
  padding: 0;
  border: 1px solid rgba(black, 0.2);
  border-radius: 4px;
}

.body--dark .style-swatch-btn {
  border-color: rgba(white, 0.3);
}
</style>
