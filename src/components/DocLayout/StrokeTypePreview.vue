<template>
  <svg viewBox="0 0 28 14" class="stroke-type-preview" aria-hidden="true">
    <line
      x1="2"
      y1="7"
      x2="26"
      y2="7"
      :stroke="color"
      stroke-width="2"
      :stroke-dasharray="dash"
      stroke-linecap="round"
    />
  </svg>
</template>

<script setup lang="ts">
/**
 * 線種（実線・破線等）を示す小さなSVGプレビュー
 *
 * スタイルパネルの線種ボタン・そのドロップダウンメニューの各選択肢で共用する
 */
import { computed } from 'vue';
import type { StrokeType } from 'src/models/document/pdf';
import { strokeTypeToPreviewDash } from 'src/utils/document/strokeDashPreview';

interface Props {
  strokeType: StrokeType;
  color?: string;
}
const props = withDefaults(defineProps<Props>(), { color: '#000000' });

const dash = computed(() => strokeTypeToPreviewDash(props.strokeType));
</script>

<style scoped lang="scss">
.stroke-type-preview {
  width: 28px;
  height: 14px;
  display: block;
}
</style>
