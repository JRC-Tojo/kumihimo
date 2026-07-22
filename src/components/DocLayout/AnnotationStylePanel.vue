<template>
  <div v-if="mode !== 'none'" class="annotation-style-panel">
    <!-- 線色（中空四角形にして塗り色ボタンと区別する） -->
    <StyleSwatchButton v-model="color" variant="outline" :tooltip="t('pdfEditor.tools.stylePanel.color')" />

    <!-- 線幅（スライダーではなく直接数字を入力する） -->
    <q-input
      :model-value="strokeWidth"
      type="number"
      dense
      borderless
      min="1"
      max="10"
      step="0.5"
      class="style-number-input"
      @update:model-value="(v) => (strokeWidth = Number(v) || undefined)"
    >
      <q-tooltip anchor="top middle" self="bottom middle">
        {{ t('pdfEditor.tools.stylePanel.strokeWidth') }}
      </q-tooltip>
    </q-input>

    <!-- 線種 -->
    <q-btn dense flat :ripple="false" class="style-icon-btn">
      <StrokeTypePreview :stroke-type="strokeType ?? 'solid'" :color="color ?? '#000000'" />
      <q-menu anchor="bottom left" self="top left">
        <q-list dense class="style-menu-list">
          <q-item
            v-for="opt in strokeTypeOptions"
            :key="opt.value"
            v-close-popup
            clickable
            :active="strokeType === opt.value"
            @click="strokeType = opt.value"
          >
            <q-item-section avatar>
              <StrokeTypePreview :stroke-type="opt.value" :color="color ?? '#000000'" />
            </q-item-section>
            <q-item-section>{{ opt.label }}</q-item-section>
          </q-item>
        </q-list>
      </q-menu>
      <q-tooltip anchor="top middle" self="bottom middle">
        {{ t('pdfEditor.tools.stylePanel.strokeType') }}
      </q-tooltip>
    </q-btn>

    <!-- 不透明度（2cm程度の小さなスライダー＋直接編集可能な数値） -->
    <div class="opacity-control">
      <q-slider
        :model-value="opacityPercent"
        :min="0"
        :max="100"
        :step="2"
        color="primary"
        class="opacity-slider"
        @update:model-value="(v) => (opacityPercent = v ?? 100)"
      />
      <q-input
        :model-value="opacityPercent"
        type="number"
        dense
        borderless
        min="0"
        max="100"
        step="2"
        class="style-number-input"
        @update:model-value="(v) => (opacityPercent = Number(v))"
      />
      <span class="opacity-unit">%</span>
      <q-tooltip anchor="top middle" self="bottom middle">
        {{ t('pdfEditor.tools.stylePanel.opacity') }}
      </q-tooltip>
    </div>

    <q-separator
      v-if="isFillableType || isHeadedType || isTextType"
      vertical
      inset
      class="style-separator"
    />

    <!-- box/circle/polygon/text: 塗り色 -->
    <StyleSwatchButton
      v-if="isFillableType"
      v-model="fillColor"
      :tooltip="t('pdfEditor.tools.stylePanel.fillColor')"
    />

    <!-- arrow/polyline: 終端の矢じり形状 -->
    <q-btn v-if="isHeadedType" dense flat :ripple="false" class="style-icon-btn">
      <q-icon :name="endHeadIcon(endHead)" size="18px" />
      <q-menu anchor="bottom left" self="top left">
        <q-list dense class="style-menu-list">
          <q-item
            v-for="opt in endHeadOptions"
            :key="opt.value"
            v-close-popup
            clickable
            :active="endHead === opt.value"
            @click="endHead = opt.value"
          >
            <q-item-section avatar>
              <q-icon :name="endHeadIcon(opt.value)" size="18px" />
            </q-item-section>
            <q-item-section>{{ opt.label }}</q-item-section>
          </q-item>
        </q-list>
      </q-menu>
      <q-tooltip anchor="top middle" self="bottom middle">
        {{ t('pdfEditor.tools.stylePanel.endHead') }}
      </q-tooltip>
    </q-btn>

    <!-- text: フォント・文字サイズ・文字色 -->
    <template v-if="isTextType">
      <q-btn dense flat no-caps :ripple="false" class="style-value-btn">
        <span class="style-value-text">{{ fontFamilyLabel }}</span>
        <q-menu anchor="bottom left" self="top left">
          <q-list dense class="style-menu-list">
            <q-item
              v-for="opt in fontFamilyOptions"
              :key="opt.value"
              v-close-popup
              clickable
              :active="fontFamily === opt.value"
              @click="fontFamily = opt.value"
            >
              <q-item-section :style="{ fontFamily: opt.value }">{{ opt.label }}</q-item-section>
            </q-item>
          </q-list>
        </q-menu>
        <q-tooltip anchor="top middle" self="bottom middle">
          {{ t('pdfEditor.tools.stylePanel.fontFamily') }}
        </q-tooltip>
      </q-btn>

      <q-btn
        dense
        flat
        :ripple="false"
        icon="remove"
        class="style-icon-btn"
        @click="fontSize = (fontSize ?? 16) - 1"
      />
      <q-input
        :model-value="fontSize"
        type="number"
        dense
        borderless
        class="style-number-input"
        @update:model-value="(v) => (fontSize = Number(v) || undefined)"
      >
        <q-tooltip anchor="top middle" self="bottom middle">
          {{ t('pdfEditor.tools.stylePanel.fontSize') }}
        </q-tooltip>
      </q-input>
      <q-btn
        dense
        flat
        :ripple="false"
        icon="add"
        class="style-icon-btn"
        @click="fontSize = (fontSize ?? 16) + 1"
      />

      <StyleSwatchButton
        v-model="textColor"
        variant="text"
        :tooltip="t('pdfEditor.tools.stylePanel.textColor')"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * アノテーションスタイルパネル
 *
 * SubTools（プリセット一覧）と同じ行に配置する、Illustrator/Affinity的なコンパクトな操作盤。
 * 常時展開されたスライダー・セレクトではなく、現在値を示す小さなスウォッチ/アイコンボタンを
 * クリックした時だけポップアップで詳細な調整UIを表示することで、SubToolsと同じ低い高さの
 * 行に収まるようにしている。選択中の配置済みアノテーションがあればそれを直接編集し
 * （選択編集モード）、なければ次に描く注釈のスタイルを編集する（描画スタイルモード）。
 * 共通4項目（線色・線幅・線種・不透明度）に加え、種別ごとの主要項目（塗り色/矢じり形状/フォント）
 * を表示する
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAnnotationStylePanel } from './composables/useAnnotationStylePanel';
import StyleSwatchButton from './StyleSwatchButton.vue';
import StrokeTypePreview from './StrokeTypePreview.vue';
import type { ArrowHeadType } from 'src/models/document/pdf';

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
    effectiveType.value === 'polygon' ||
    effectiveType.value === 'text',
);
const isHeadedType = computed(
  () => effectiveType.value === 'arrow' || effectiveType.value === 'polyline',
);
const isTextType = computed(() => effectiveType.value === 'text');

/** 不透明度（0〜1）を、スライダー・数値入力で扱いやすいパーセント（0〜100）表示に変換する */
const opacityPercent = computed<number>({
  get: () => Math.round((opacity.value ?? 1) * 100),
  set: (v) => {
    opacity.value = Math.min(100, Math.max(0, v)) / 100;
  },
});

const strokeTypeOptions = computed(() => [
  { label: t('pdfEditor.tools.stylePanel.strokeTypeOptions.solid'), value: 'solid' as const },
  { label: t('pdfEditor.tools.stylePanel.strokeTypeOptions.dashed'), value: 'dashed' as const },
  { label: t('pdfEditor.tools.stylePanel.strokeTypeOptions.dotted'), value: 'dotted' as const },
  { label: t('pdfEditor.tools.stylePanel.strokeTypeOptions.dashDot'), value: 'dash-dot' as const },
  { label: t('pdfEditor.tools.stylePanel.strokeTypeOptions.double'), value: 'double' as const },
]);

const endHeadOptions = computed(() => [
  { label: t('pdfEditor.tools.stylePanel.endHeadOptions.none'), value: 'none' as const },
  { label: t('pdfEditor.tools.stylePanel.endHeadOptions.triangle'), value: 'triangle' as const },
  { label: t('pdfEditor.tools.stylePanel.endHeadOptions.open'), value: 'open' as const },
]);

/** 矢じり形状に対応するMaterial Iconsのアイコン名 */
function endHeadIcon(head: ArrowHeadType | undefined): string {
  switch (head) {
    case 'triangle':
      return 'arrow_forward';
    case 'open':
      return 'north_east';
    default:
      return 'horizontal_rule';
  }
}

const fontFamilyOptions = [
  { label: 'Sans Serif', value: 'sans-serif' },
  { label: 'Serif', value: 'serif' },
  { label: 'Monospace', value: 'monospace' },
];
const fontFamilyLabel = computed(
  () => fontFamilyOptions.find((opt) => opt.value === fontFamily.value)?.label ?? 'Sans Serif',
);
</script>

<style scoped lang="scss">
.annotation-style-panel {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  height: 100%;
  padding: 0 0.4rem;
  flex-shrink: 0;
  flex-wrap: nowrap;
}

.style-icon-btn {
  min-height: 24px;
  min-width: 28px;
  padding: 0 0.3rem;
}

.style-value-btn {
  min-height: 24px;
  padding: 0 0.4rem;
}

.style-value-text {
  font-size: 0.75rem;
  white-space: nowrap;
}

.style-number-input {
  width: 44px;
  font-size: 0.75rem;

  :deep(.q-field__control) {
    height: 24px;
  }
}

.opacity-control {
  display: flex;
  align-items: center;
  gap: 0.15rem;
}

// 約2cm相当（96dpiベース）の小さなスライダー
.opacity-slider {
  width: 76px;

  :deep(.q-slider) {
    color: $primary;
  }
}

.opacity-unit {
  font-size: 0.7rem;
  color: $grey-7;
}

.style-separator {
  height: 20px;
}

.style-menu-list {
  min-width: 140px;
}
</style>
