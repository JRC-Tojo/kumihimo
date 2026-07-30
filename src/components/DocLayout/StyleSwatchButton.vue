<template>
  <q-btn
    dense
    flat
    :ripple="false"
    :disable="disable"
    class="style-swatch-btn"
    :class="{ 'style-swatch-btn--outline': variant === 'outline' }"
    :style="swatchStyle"
  >
    <span
      v-if="variant === 'text'"
      class="style-swatch-text-a"
      :style="{ color: colorValue ?? '#000000' }"
    >
      A
    </span>
    <!-- 「色なし」を示す斜線オーバーレイ（Illustrator等の「なし」スウォッチと同じ視覚言語） -->
    <div v-if="isNone" class="swatch-none-slash" aria-hidden="true" />
    <q-popup-proxy cover transition-show="scale" transition-hide="scale" @hide="commitColorPick()">
      <div class="style-swatch-popup q-pa-sm">
        <!-- 直近で使用した色（設定の件数分。未登録分は白で埋める）＋「色なし」スウォッチ -->
        <div class="recent-colors-row">
          <q-btn
            v-if="allowNone && variant !== 'text'"
            dense
            flat
            :ripple="false"
            class="recent-color-swatch recent-color-swatch--none"
            @click="pickNone"
          >
            <div class="swatch-none-slash" aria-hidden="true" />
            <q-tooltip>{{ t('pdfEditor.tools.stylePanel.noColor') }}</q-tooltip>
          </q-btn>
          <q-btn
            v-for="(recent, i) in recentColorsPadded"
            :key="i"
            dense
            flat
            :ripple="false"
            :disable="recent === undefined"
            class="recent-color-swatch"
            :style="{ backgroundColor: recent ?? '#ffffff' }"
            @click="pickRecentColor(recent)"
          >
            <q-tooltip v-if="recent">{{ recent }}</q-tooltip>
          </q-btn>
        </div>
        <q-color :model-value="colorValue ?? '#000000'" @update:model-value="updateLivePreview" />
      </div>
    </q-popup-proxy>
    <q-tooltip anchor="top middle" self="bottom middle">{{ tooltip }}</q-tooltip>
  </q-btn>
</template>

<script setup lang="ts">
/**
 * アノテーションスタイルパネルで使う、小さな色スウォッチボタン
 *
 * Illustrator/Affinity的な操作盤を意識し、常時展開されたカラーピッカーではなく、
 * クリックでポップアップ表示するコンパクトなスウォッチのみを常設する。ポップアップ内には
 * 直近で使用した色（AppSettingsで件数変更可、未登録分は白で埋める）・「色なし」スウォッチも並べ、
 * ワンクリックで再選択できるようにする。
 *
 * 直近使用色への保存は、ポップアップが閉じた時点（確定時）のみ行う。`q-color`は
 * ドラッグ中も`update:model-value`を連続発火するため、ドラッグ中の値はライブプレビュー
 * （`colorValue`の更新）にのみ使い、永続化（`recordRecentColor`）は`commitColorPick`に一本化する
 */
import { useSettingsStore } from 'src/stores/settingsStore';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

interface Props {
  tooltip: string;
  // 'fill': 塗りつぶし四角形（既定・塗り色用）, 'outline': 中空四角形（線色用、塗り色ボタンと区別するため）,
  // 'text': 色付きの「A」文字（文字色用、Word/PowerPoint等の「フォントの色」ボタンに近い見た目）
  variant?: 'fill' | 'outline' | 'text';
  // trueの間、色の変更（ポップアップ表示自体）を無効化する（関係性検証結果の色で上書き中の場合に使う）
  disable?: boolean;
  // 「色なし」スウォッチを表示するかどうか（文字色は常に必須のため、variant==='text'では無視される）
  allowNone?: boolean;
}
const props = withDefaults(defineProps<Props>(), {
  variant: 'fill',
  disable: false,
  allowNone: true,
});

const { t } = useI18n();
const colorValue = defineModel<string | undefined>({ required: true });

const settingsStore = useSettingsStore();

/** 「色なし」状態かどうか（文字色は常に必須のため、variant==='text'では常にfalse扱い） */
const isNone = computed(() => props.variant !== 'text' && colorValue.value === undefined);

const swatchStyle = computed(() => {
  /** 無効化中は実際の色に関わらずグレー表示を優先し、それ以外は現在値（無ければ既定色）を返す */
  const colorSetter = (defColor: string) =>
    props.disable ? 'gray' : (colorValue.value ?? defColor);

  if (props.variant === 'outline') {
    return { backgroundColor: 'transparent', borderColor: colorSetter('#000000') };
  }
  if (props.variant === 'text') {
    // プリセットプレビュー（AnnotationPresetPreview.vue）と同様、ダークモードでも
    // 文字色（黒等）が見えなくならないよう、常に明るい背景の上に表示する
    return { backgroundColor: '#ffffff' };
  }
  return { backgroundColor: colorSetter('#ffffff') };
});

const recentColorsPadded = computed<(string | undefined)[]>(() => {
  const limit = settingsStore.appSettings?.tools.recentColorsLimit ?? 5;
  const colors = settingsStore.appSettings?.tools.recentColors ?? [];
  return Array.from({ length: limit }, (_, i) => colors[i]);
});

// commitColorPickでの二重永続化（pickRecentColorで既に保存済みの値の再保存）を避けるための記録
const lastPersistedColor = ref<string | undefined>(undefined);

/** q-colorのライブプレビュー用。ドラッグ中も連続発火するため、ここでは永続化しない */
function updateLivePreview(value: string | null | undefined) {
  if (!value) return;
  colorValue.value = value;
}

/** 直近使用色のクリックは確定的な操作のため、従来通り即座に反映・永続化する */
function pickRecentColor(value: string | undefined) {
  if (!value) return;
  colorValue.value = value;
  void settingsStore.recordRecentColor(value);
  lastPersistedColor.value = value;
}

/** 「色なし」スウォッチのクリック。明示的にcolorValueをundefinedにする（再利用可能な色ではないため直近使用色には記録しない） */
function pickNone() {
  colorValue.value = undefined;
}

/**
 * 色選択ダイアログ（ポップアップ）が閉じた時点で1回だけ、その時点のcolorValueを
 * 直近使用色へ永続化する。ドラッグ中・調整中に何度も保存してしまわないよう、
 * 確定タイミングをポップアップの`hide`一箇所のみに一本化する
 */
function commitColorPick() {
  const value = colorValue.value;
  if (!value || value === lastPersistedColor.value) return;
  void settingsStore.recordRecentColor(value);
  lastPersistedColor.value = value;
}
</script>

<style scoped lang="scss">
.style-swatch-btn {
  position: relative;
  width: 20px;
  height: 20px;
  min-height: 20px;
  padding: 0;
  border: 1px solid rgba(black, 0.2);
  border-radius: 4px;

  &--outline {
    border-width: 2px;
  }
}

.style-swatch-text-a {
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
}

.swatch-none-slash {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    to top right,
    transparent calc(50% - 1px),
    #e53935 calc(50% - 1px),
    #e53935 calc(50% + 1px),
    transparent calc(50% + 1px)
  );
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
  position: relative;
  width: 18px;
  height: 18px;
  min-height: 18px;
  padding: 0;
  border: 1px solid rgba(black, 0.2);
  border-radius: 3px;

  &:disabled {
    opacity: 0.5;
  }

  &--none {
    background: #ffffff;
  }
}

.body--dark .recent-color-swatch {
  border-color: rgba(white, 0.3);
}
</style>
