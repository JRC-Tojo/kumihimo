<template>
  <v-layer :ref="setLayerRef">
    <slot />
  </v-layer>
</template>

<script setup lang="ts">
/**
 * 注釈1件分の合成モードを、自身専用のKonvaレイヤー（＝専用canvas要素）へCSSのmix-blend-modeとして適用する
 *
 * 合成モードはKonvaの`globalCompositeOperation`だけではKonvaキャンバス内の重なりにしか反映されず、
 * 別canvas要素であるPDF描画側（文書の文字）には影響しない。注釈ごとに専用のレイヤーを割り当て、
 * その実体であるcanvas要素へCSSの`mix-blend-mode`を適用することで、注釈ごとに異なる合成モードでも
 * 文書の文字と正しく合成できるようにする（レイヤー全体へ一括適用すると、現在選択中/描画中の
 * スタイルパネルの値で他の注釈まで上書きされてしまうため、1レイヤー1注釈に分離している）
 */
import { onBeforeUnmount, watch } from 'vue';
import type Konva from 'konva';
import type { BlendMode } from 'src/models/document/pdf';

interface Props {
  blendMode?: BlendMode | undefined;
}

const props = defineProps<Props>();

let layerNode: Konva.Layer | null = null;

/** 保持中のレイヤーノードのcanvas要素へ、現在のblendMode（未設定時は'normal'）を反映する */
function applyBlendMode() {
  const canvas = layerNode?.getCanvas()._canvas;
  if (canvas) canvas.style.mixBlendMode = props.blendMode ?? 'normal';
}

function setLayerRef(el: unknown) {
  layerNode = (el as { getNode: () => Konva.Layer } | null)?.getNode() ?? null;
  applyBlendMode();
}

watch(() => props.blendMode, applyBlendMode);
onBeforeUnmount(() => {
  layerNode = null;
});
</script>
