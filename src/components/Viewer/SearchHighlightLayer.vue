<template>
  <!-- Ctrl+F検索のマッチ箇所ハイライト（issue #33）。常にpointer-events: noneで、
       アノテーション操作・テキスト選択レイヤーのいずれの操作も一切妨げない -->
  <div class="search-highlight-layer">
    <div
      v-for="match in matches"
      :id="searchMatchDomId(match)"
      :key="searchMatchDomId(match)"
      class="search-highlight-layer__match"
    >
      <!-- アイテム境界をまたぐマッチは複数の矩形（boxes）を持つため、すべて描画する -->
      <div
        v-for="(box, boxIndex) in match.boxes"
        :key="boxIndex"
        class="search-highlight-layer__box"
        :class="{
          'search-highlight-layer__box--active': searchMatchDomId(match) === activeMatchId,
        }"
        :style="boxStyle(box)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { TextSearchMatch } from 'src/models/document/search';
import type { BoundingBox } from 'src/models/common';
import { searchMatchDomId } from 'src/utils/document/textSearch';

interface Props {
  /** このページに属するマッチのみを渡す想定（呼び出し側でpageNumberフィルタ済み） */
  matches: TextSearchMatch[];
  /** 現在アクティブなマッチのDOM id（`searchMatchDomId`）。一致する矩形だけ強調表示する */
  activeMatchId?: string | undefined;
  /** スケール1（PDF自体の座標系）から、このレイヤーが実際に描画されるpxへの倍率 */
  scale: number;
}
const props = defineProps<Props>();

function boxStyle(box: BoundingBox): Record<string, string> {
  return {
    left: `${box.x * props.scale}px`,
    top: `${box.y * props.scale}px`,
    width: `${box.width * props.scale}px`,
    height: `${box.height * props.scale}px`,
  };
}
</script>

<style scoped lang="scss">
.search-highlight-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.search-highlight-layer__match {
  position: absolute;
  inset: 0;
}

.search-highlight-layer__box {
  position: absolute;
  background: $search-highlight;
  border-radius: 2px;

  &--active {
    background: $search-highlight-active;
    outline: 2px solid rgba(255, 90, 0, 0.9);
  }
}
</style>
