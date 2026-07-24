<template>
  <svg viewBox="0 0 28 14" class="stroke-type-preview" aria-hidden="true">
    <!-- ダークモードでも線色（黒等）が見えなくならないよう、常に明るい背景チップの上に描画する -->
    <rect x="0" y="0" width="28" height="14" rx="3" class="preview-backdrop" />

    <!--
      stroke-linecapは意図的にbutt（既定値）のままにしている。'round'にすると、
      線幅(2)に対して破線・点線の間隔（strokeDashPreview.ts参照）が近すぎるため、
      丸められた線端が隙間を埋めてしまい、実線とほぼ見分けがつかなくなってしまう
    -->
    <line x1="2" y1="7" x2="26" y2="7" :stroke="color" stroke-width="2" :stroke-dasharray="dash" />
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

.preview-backdrop {
  fill: #f4f4f5;
  stroke: rgba(0, 0, 0, 0.12);
  stroke-width: 1;
}
</style>
