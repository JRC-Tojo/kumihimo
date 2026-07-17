<template>
  <div v-if="mode !== 'none'" class="annotation-style-panel">
    <!-- 線色 -->
    <div class="style-field">
      <q-btn round dense class="color-swatch" :style="{ backgroundColor: color ?? '#ffffff' }">
        <q-popup-proxy cover transition-show="scale" transition-hide="scale">
          <q-color :model-value="color ?? '#000000'" @update:model-value="(v) => (color = v ?? undefined)" />
        </q-popup-proxy>
      </q-btn>
      <q-tooltip>{{ $t('pdfEditor.tools.stylePanel.color') }}</q-tooltip>
    </div>

    <!-- 線幅 -->
    <div class="style-field style-field-slider">
      <span class="style-field-label">{{ $t('pdfEditor.tools.stylePanel.strokeWidth') }}</span>
      <q-slider
        :model-value="strokeWidth ?? 2"
        :min="1"
        :max="10"
        :step="0.5"
        label
        dense
        class="style-slider"
        @update:model-value="(v) => (strokeWidth = v ?? undefined)"
      />
    </div>

    <!-- 線種 -->
    <q-select
      :model-value="strokeType"
      :options="strokeTypeOptions"
      emit-value
      map-options
      dense
      outlined
      class="style-select"
      :label="$t('pdfEditor.tools.stylePanel.strokeType')"
      @update:model-value="(v) => (strokeType = v)"
    />

    <!-- 不透明度 -->
    <div class="style-field style-field-slider">
      <span class="style-field-label">{{ $t('pdfEditor.tools.stylePanel.opacity') }}</span>
      <q-slider
        :model-value="opacity ?? 1"
        :min="0"
        :max="1"
        :step="0.1"
        label
        dense
        class="style-slider"
        @update:model-value="(v) => (opacity = v ?? undefined)"
      />
    </div>

    <q-separator vertical inset class="style-separator" />

    <!-- box/circle/polygon: 塗り色 -->
    <div v-if="isFillableType" class="style-field">
      <q-btn
        round
        dense
        class="color-swatch"
        :style="{ backgroundColor: fillColor ?? '#ffffff' }"
      >
        <q-popup-proxy cover transition-show="scale" transition-hide="scale">
          <q-color
            :model-value="fillColor ?? '#000000'"
            @update:model-value="(v) => (fillColor = v ?? undefined)"
          />
        </q-popup-proxy>
      </q-btn>
      <q-tooltip>{{ $t('pdfEditor.tools.stylePanel.fillColor') }}</q-tooltip>
    </div>

    <!-- arrow/polyline: 終端の矢じり形状 -->
    <q-select
      v-if="isHeadedType"
      :model-value="endHead"
      :options="endHeadOptions"
      emit-value
      map-options
      dense
      outlined
      class="style-select"
      :label="$t('pdfEditor.tools.stylePanel.endHead')"
      @update:model-value="(v) => (endHead = v)"
    />

    <!-- text: フォント・文字色 -->
    <template v-if="isTextType">
      <q-select
        :model-value="fontFamily"
        :options="fontFamilyOptions"
        emit-value
        map-options
        dense
        outlined
        class="style-select"
        :label="$t('pdfEditor.tools.stylePanel.fontFamily')"
        @update:model-value="(v) => (fontFamily = v)"
      />
      <q-input
        :model-value="fontSize"
        type="number"
        dense
        outlined
        class="style-number"
        :label="$t('pdfEditor.tools.stylePanel.fontSize')"
        @update:model-value="(v) => (fontSize = Number(v) || undefined)"
      />
      <div class="style-field">
        <q-btn
          round
          dense
          class="color-swatch"
          :style="{ backgroundColor: textColor ?? '#000000' }"
        >
          <q-popup-proxy cover transition-show="scale" transition-hide="scale">
            <q-color
              :model-value="textColor ?? '#000000'"
              @update:model-value="(v) => (textColor = v ?? undefined)"
            />
          </q-popup-proxy>
        </q-btn>
        <q-tooltip>{{ $t('pdfEditor.tools.stylePanel.textColor') }}</q-tooltip>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * アノテーションスタイルパネル
 *
 * SubTools（プリセット一覧）の隣に配置する、Illustrator/Affinity的な「スマートな操作盤」。
 * 選択中の配置済みアノテーションがあればそれを直接編集し（選択編集モード）、
 * なければ次に描く注釈のスタイルを編集する（描画スタイルモード）。共通4項目（線色・線幅・
 * 線種・不透明度）に加え、種別ごとの主要項目（塗り色/矢じり形状/フォント）を表示する
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAnnotationStylePanel } from './composables/useAnnotationStylePanel';

const { t } = useI18n();

const {
  mode,
  effectiveType,
  color,
  strokeWidth,
  strokeType,
  opacity,
  fillColor,
  endHead,
  fontFamily,
  fontSize,
  textColor,
} = useAnnotationStylePanel();

const isFillableType = computed(
  () =>
    effectiveType.value === 'box' ||
    effectiveType.value === 'circle' ||
    effectiveType.value === 'polygon',
);
const isHeadedType = computed(
  () => effectiveType.value === 'arrow' || effectiveType.value === 'polyline',
);
const isTextType = computed(() => effectiveType.value === 'text');

const strokeTypeOptions = computed(() => [
  { label: t('pdfEditor.tools.stylePanel.strokeTypeOptions.solid'), value: 'solid' },
  { label: t('pdfEditor.tools.stylePanel.strokeTypeOptions.dashed'), value: 'dashed' },
  { label: t('pdfEditor.tools.stylePanel.strokeTypeOptions.dotted'), value: 'dotted' },
  { label: t('pdfEditor.tools.stylePanel.strokeTypeOptions.dashDot'), value: 'dash-dot' },
  { label: t('pdfEditor.tools.stylePanel.strokeTypeOptions.double'), value: 'double' },
]);

const endHeadOptions = computed(() => [
  { label: t('pdfEditor.tools.stylePanel.endHeadOptions.none'), value: 'none' },
  { label: t('pdfEditor.tools.stylePanel.endHeadOptions.triangle'), value: 'triangle' },
  { label: t('pdfEditor.tools.stylePanel.endHeadOptions.open'), value: 'open' },
]);

const fontFamilyOptions = [
  { label: 'Sans Serif', value: 'sans-serif' },
  { label: 'Serif', value: 'serif' },
  { label: 'Monospace', value: 'monospace' },
];
</script>

<style scoped lang="scss">
.annotation-style-panel {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.25rem 0.5rem;
  flex-shrink: 0;
  flex-wrap: nowrap;
}

.style-field {
  display: flex;
  align-items: center;
}

.style-field-slider {
  min-width: 120px;
  gap: 0.4rem;
}

.style-field-label {
  font-size: 0.75rem;
  color: $grey-7;
  white-space: nowrap;
}

.style-slider {
  width: 80px;
}

.style-select {
  width: 130px;
}

.style-number {
  width: 80px;
}

.color-swatch {
  width: 28px;
  height: 28px;
  border: 1px solid $grey-5;
}

.style-separator {
  height: 24px;
}

.body--dark .style-field-label {
  color: $grey-4;
}
</style>
