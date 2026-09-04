<template>
  <!-- 文書内テキストをカーソルで選択可能にする、透明なDOMオーバーレイ層（issue #33）
       pdf.jsのTextLayerと同様の考え方で、各テキストアイテムの位置に透明な<span>を重ねる。
       `interactive`がfalseの間（テキスト選択ツール未選択時）はpointer-eventsを一切受け付けず、
       既存のアノテーション描画・選択操作（Konvaレイヤー）を完全に妨げない -->
  <div
    class="text-layer"
    :class="{ 'text-layer--interactive': interactive }"
    :style="{ pointerEvents: interactive ? 'auto' : 'none' }"
  >
    <span v-for="(box, idx) in boxes" :key="idx" class="text-layer__item" :style="spanStyle(box)">{{
      box.text
    }}</span>
  </div>
</template>

<script setup lang="ts">
import type { TextItemBox } from 'src/models/document/pdf';

interface Props {
  /** このページのテキストアイテム一覧（スケール1のバウンディングボックス付き） */
  boxes: TextItemBox[];
  /** スケール1（PDF自体の座標系）から、このレイヤーが実際に描画されるpxへの倍率
   * （`PdfPage.vue`の`lastRenderedScale`。バックドロップcanvasと同じ基準を使うことで位置が一致する） */
  scale: number;
  /** テキスト選択ツールが有効かどうか。falseの間はpointer-events: noneで完全に透過する */
  interactive: boolean;
}
const props = defineProps<Props>();

// 実際の文字幅測定用のcanvas 2Dコンテキストをモジュールスコープで使い回す
// （spanごとに毎回生成すると、テキストアイテム数の多いページで無駄なコストになる）
let measureCtx: CanvasRenderingContext2D | null | undefined;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx === undefined) {
    measureCtx = document.createElement('canvas').getContext('2d');
  }
  return measureCtx;
}

/**
 * 各テキストアイテムを、スケール後の位置・寸法に変換したCSSスタイルを返す
 *
 * フォントで実際に描画した際の自然な文字幅と、PDF側が期待する文字幅（`box.width`）は
 * 一般に一致しないため、pdf.js本家のTextLayerと同じ手法（`transform: scaleX(...)`で
 * 実測幅を強制的にbox.widthへ引き伸ばす）を使い、下に見えるCanvas描画の文字位置とズレないようにする
 */
function spanStyle(box: TextItemBox): Record<string, string> {
  const fontSize = box.height * props.scale;
  const targetWidth = box.width * props.scale;

  let scaleX = 1;
  const ctx = getMeasureCtx();
  if (ctx && box.text.length > 0 && fontSize > 0) {
    ctx.font = `${fontSize}px sans-serif`;
    const measuredWidth = ctx.measureText(box.text).width;
    if (measuredWidth > 0) scaleX = targetWidth / measuredWidth;
  }

  return {
    left: `${box.x * props.scale}px`,
    top: `${box.y * props.scale}px`,
    fontSize: `${fontSize}px`,
    lineHeight: `${fontSize}px`,
    transform: `scaleX(${scaleX})`,
  };
}
</script>

<style scoped lang="scss">
.text-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  user-select: none;

  &.text-layer--interactive {
    user-select: text;
    cursor: text;
  }
}

.text-layer__item {
  position: absolute;
  top: 0;
  left: 0;
  white-space: pre;
  color: transparent;
  transform-origin: 0 0;
}

.text-layer--interactive .text-layer__item::selection {
  background: rgba(0, 100, 255, 0.35);
}
</style>
