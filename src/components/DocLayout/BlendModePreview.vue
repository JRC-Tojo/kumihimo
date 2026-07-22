<template>
  <div class="blend-mode-preview">
    <div class="blend-mode-preview-square blend-mode-preview-square--base" />
    <div
      class="blend-mode-preview-square blend-mode-preview-square--overlay"
      :style="{ mixBlendMode: blendMode }"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 合成モード（ブレンドモード）を示す小さなプレビュー
 *
 * 2つの正方形が重なった際の見た目を、実際にCSSの`mix-blend-mode`で描画して示す。
 * 'normal'はCSS側にもそのまま存在するため、Canvas用の'source-over'への読み替えは不要
 */
import type { BlendMode } from 'src/models/document/pdf';

interface Props {
  blendMode: BlendMode;
}
defineProps<Props>();
</script>

<style scoped lang="scss">
.blend-mode-preview {
  position: relative;
  width: 28px;
  height: 20px;
  border-radius: 3px;
  overflow: hidden;
  // ダークモードでも見え方が変わらないよう、常に明るい背景チップの上に描画する
  background: #f4f4f5;
  border: 1px solid rgba(black, 0.12);
}

.blend-mode-preview-square {
  position: absolute;
  width: 16px;
  height: 12px;
  border-radius: 2px;
}

.blend-mode-preview-square--base {
  left: 2px;
  top: 3px;
  background: #2196f3;
}

.blend-mode-preview-square--overlay {
  left: 10px;
  top: 5px;
  background: #f44336;
}
</style>
