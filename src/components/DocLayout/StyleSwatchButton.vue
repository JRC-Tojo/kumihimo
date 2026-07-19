<template>
  <q-btn
    dense
    flat
    :ripple="false"
    class="style-swatch-btn"
    :style="{ backgroundColor: colorValue ?? '#ffffff' }"
  >
    <q-popup-proxy cover transition-show="scale" transition-hide="scale">
      <div class="style-swatch-popup q-pa-sm">
        <!-- 直近で使用した色（設定の件数分。未登録分は白で埋める） -->
        <div class="recent-colors-row">
          <q-btn
            v-for="(recent, i) in recentColorsPadded"
            :key="i"
            dense
            flat
            :ripple="false"
            :disable="recent === undefined"
            class="recent-color-swatch"
            :style="{ backgroundColor: recent ?? '#ffffff' }"
            @click="onPick(recent)"
          >
            <q-tooltip v-if="recent">{{ recent }}</q-tooltip>
          </q-btn>
        </div>
        <q-color :model-value="colorValue ?? '#000000'" @update:model-value="onPick" />
      </div>
    </q-popup-proxy>
    <q-tooltip>{{ tooltip }}</q-tooltip>
  </q-btn>
</template>

<script setup lang="ts">
import { useSettingsStore } from 'src/stores/settingsStore';
import { computed } from 'vue';

/**
 * スタイルパネル・RightDrawerで共用する、小さな色スウォッチボタン
 *
 * Illustrator/Affinity的な操作盤を意識し、常時展開されたカラーピッカーではなく、
 * クリックでポップアップ表示するコンパクトなスウォッチのみを常設する。ポップアップ内には
 * 直近で使用した色（AppSettingsで件数変更可、未登録分は白で埋める）も並べ、ワンクリックで
 * 再選択できるようにする
 */
interface Props {
  tooltip: string;
}
defineProps<Props>();

const colorValue = defineModel<string | undefined>({ required: true });

const settingsStore = useSettingsStore();

const recentColorsPadded = computed<(string | undefined)[]>(() => {
  const limit = settingsStore.appSettings?.tools.recentColorsLimit ?? 5;
  const colors = settingsStore.appSettings?.tools.recentColors ?? [];
  return Array.from({ length: limit }, (_, i) => colors[i]);
});

/** カラーピッカー・直近使用色のどちらから選んだ場合も、値を反映したうえで直近使用色に記録する */
function onPick(value: string | null | undefined) {
  if (!value) return;
  colorValue.value = value;
  void settingsStore.recordRecentColor(value);
}
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

.style-swatch-popup {
  background: white;
}

.body--dark .style-swatch-popup {
  background: $dark-page;
}

.recent-colors-row {
  display: flex;
  gap: 0.3rem;
  margin-bottom: 0.5rem;
}

.recent-color-swatch {
  width: 18px;
  height: 18px;
  min-height: 18px;
  padding: 0;
  border: 1px solid rgba(black, 0.2);
  border-radius: 3px;

  &:disabled {
    opacity: 0.5;
  }
}

.body--dark .recent-color-swatch {
  border-color: rgba(white, 0.3);
}
</style>
