<template>
  <VueDraggable
    v-model="presetsForType"
    :animation="150"
    :onMove="handleMove"
    filter=".drag-disabled"
    class="annotation-preset-bar"
  >
    <div
      v-for="preset in presetsForType"
      :key="preset.id"
      class="preset-item"
      :class="{ active: isActivePreset(preset) }"
      @click="applyPreset(preset)"
      @dblclick="onPresetDoubleClick(preset)"
    >
      <AnnotationPresetPreview :annotation-style="preset.style" />
      <q-tooltip :delay="400" anchor="top middle" self="bottom middle">{{ preset.name }}</q-tooltip>

      <q-menu context-menu class="preset-item-actions">
        <q-list dense style="min-width: 150px">
          <q-item v-close-popup clickable @click="onRename(preset)">
            <q-item-section>{{ $t('pdfEditor.tools.presetBar.rename') }}</q-item-section>
          </q-item>
          <q-item v-close-popup clickable @click="onUpdateStyle(preset)">
            <q-item-section>{{ $t('pdfEditor.tools.presetBar.updateStyle') }}</q-item-section>
          </q-item>
          <q-item v-close-popup clickable @click="onDelete(preset)" class="text-negative">
            <q-item-section>{{ $t('pdfEditor.tools.presetBar.delete') }}</q-item-section>
          </q-item>
        </q-list>
      </q-menu>
    </div>

    <q-btn
      dense
      flat
      round
      icon="add"
      class="preset-add-button drag-disabled"
      :title="$t('pdfEditor.tools.presetBar.add')"
      @click="onAdd"
    />
  </VueDraggable>
</template>

<script setup lang="ts">
/**
 * アノテーションプリセット一覧（SubTools後継）
 *
 * 描画スタイルモード（メインツールでアノテーション種別を選択中）・選択編集モード
 * （配置済みアノテーションを選択中）の両方で使う。`useAnnotationStylePanel`と同じ
 * `mode`/`effectiveType`を共有し、選択編集モードでは選択中アノテーション群へプリセットを
 * 適用したり、その場のスタイルを新規プリセットとして登録できるようにする。
 * プリセットはビジュアルプレビュー（AnnotationPresetPreview）のみを表示し、名前はTooltipで示す。
 * ドラッグ並び替え・追加・名前変更・現在スタイルへの更新・削除をサポートする
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { type MoveEvent, VueDraggable } from 'vue-draggable-plus';
import AnnotationPresetPreview from './AnnotationPresetPreview.vue';
import { useEditorStore } from 'src/stores/editorStore';
import { useSettingsStore } from 'src/stores/settingsStore';
import type { AnnotationTool, DrawingAnnotationStyle } from 'src/models/docPage';
import { useAnnotationStylePanel } from './composables/useAnnotationStylePanel';
import {
  annotationStyleToPresetStyle,
  reorderPresetsOfType,
} from './composables/useAnnotationPresets';
import { confirmDialog, promptDialog } from 'src/components/Dialog/confirmDialog';
import { registerAnnotationPreset } from './composables/useAnnotationPresetRegistration';

const { t } = useI18n();
const $q = useQuasar();
const editorStore = useEditorStore();
const settingsStore = useSettingsStore();
const { mode, effectiveType, applyPresetStyleToSelection } = useAnnotationStylePanel();

const allPresets = computed(() => settingsStore.appSettings?.tools.annotations ?? []);

const presetsForType = computed<AnnotationTool[]>({
  get: () => {
    const type = effectiveType.value;
    return type === undefined ? [] : allPresets.value.filter((p) => p.style.type === type);
  },
  set: (reordered) => {
    const type = effectiveType.value;
    if (type === undefined) return;
    void settingsStore.updateAnnotationPresets(
      reorderPresetsOfType(allPresets.value, type, reordered),
    );
  },
});

/**
 * プリセットの新規登録・上書きに使う「現在のスタイル」。
 * 描画スタイルモードでは次に描く注釈のスタイル、選択編集モードでは選択中アノテーション
 * （型が揃っている前提のため先頭の1件を代表として使う）から変換したスタイルを返す
 */
function currentStyleForPresetOp(): DrawingAnnotationStyle | undefined {
  if (mode.value === 'selection') {
    const first = editorStore.activeSelection?.annotations[0];
    return first ? annotationStyleToPresetStyle(first) : undefined;
  }
  return editorStore.currentAnnotationStyle;
}

const handleMove = (evt: MoveEvent) => {
  // 割り込み先の要素が .drag-disabled を持っていたら移動をキャンセル
  if (evt.related && evt.related.classList.contains('drag-disabled')) {
    return false;
  }
};

/**
 * 2つのスタイルオブジェクトが同じ内容かどうかを、キーの並び順に依存せず判定する
 *
 * `DrawingAnnotationStyle`は全フィールドがプリミティブ値（文字列・数値等）のみで
 * ネストしたオブジェクト・配列を持たないため、キー集合と値の一致だけで十分比較できる
 */
function isSameStyle(a: DrawingAnnotationStyle, b: DrawingAnnotationStyle): boolean {
  const aEntries = Object.entries(a);
  if (aEntries.length !== Object.keys(b).length) return false;
  return aEntries.every(([key, value]) => (b as Record<string, unknown>)[key] === value);
}

/** 現在のcurrentAnnotationStyleと一致するプリセットをハイライトする */
function isActivePreset(preset: AnnotationTool): boolean {
  // 選択編集モードは複数アノテーションの内訳が混在しうるため、ハイライトは描画モードのみ行う
  if (mode.value !== 'draw') return false;
  return isSameStyle(editorStore.currentAnnotationStyle, preset.style);
}

function applyPreset(preset: AnnotationTool) {
  if (mode.value === 'selection') {
    void applyPresetStyleToSelection(preset.style);
    return;
  }
  editorStore.currentTools = preset.style.type;
  editorStore.currentAnnotationStyle = preset.style;
}

/**
 * プリセットをダブルクリックした場合、描画スタイルモードでは連続描画モード（stickyDrawMode）を
 * 有効にする。通常は1つ描くたびに選択モードへ自動的に戻るが、これを有効にしている間は
 * 同じツール・スタイルのまま描き続けられるようにする
 */
function onPresetDoubleClick(preset: AnnotationTool) {
  if (mode.value !== 'draw') return;
  applyPreset(preset);
  editorStore.stickyDrawMode = true;
}

async function onRename(preset: AnnotationTool) {
  const newName = await promptDialog({
    title: t('pdfEditor.tools.presetBar.rename'),
    promptLabel: t('pdfEditor.tools.presetBar.nameLabel'),
    initialValue: preset.name,
  });
  if (newName === undefined || newName.trim() === '') return;

  const newList = allPresets.value.map((p) => (p.id === preset.id ? { ...p, name: newName } : p));
  await settingsStore.updateAnnotationPresets(newList);
}

async function onUpdateStyle(preset: AnnotationTool) {
  const style = currentStyleForPresetOp();
  if (!style) return;

  const newList = allPresets.value.map((p) => (p.id === preset.id ? { ...p, style } : p));
  const ok = await settingsStore.updateAnnotationPresets(newList);
  if (ok) {
    $q.notify({ type: 'positive', message: t('pdfEditor.tools.presetBar.updateStyleSuccess') });
  }
}

async function onDelete(preset: AnnotationTool) {
  const proceed = await confirmDialog({
    title: t('pdfEditor.tools.presetBar.delete'),
    message: t('pdfEditor.tools.presetBar.deleteConfirm', { name: preset.name }),
    severity: 'negative',
  });
  if (!proceed) return;

  const newList = allPresets.value.filter((p) => p.id !== preset.id);
  await settingsStore.updateAnnotationPresets(newList);
}

async function onAdd() {
  const style = currentStyleForPresetOp();
  if (!style) return;
  await registerAnnotationPreset(t, settingsStore, style);
}
</script>

<style scoped lang="scss">
.annotation-preset-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 0.25rem;
  min-width: 0;

  &::-webkit-scrollbar {
    height: 6px;
  }

  &::-webkit-scrollbar-thumb {
    background: $grey-4;
    border-radius: 3px;
  }
}

.preset-item {
  position: relative;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: 1px solid $grey-4;
  cursor: pointer;
  background: white;
  transition: all 0.15s ease;

  &:hover {
    border-color: $primary;

    .preset-item-actions {
      opacity: 1;
      pointer-events: auto;
    }
  }

  &.active {
    border-color: $primary;
    border-width: 2px;
    box-shadow: 0 0 0 2px rgba($primary, 0.15);
  }
}

.preset-item-actions {
  position: absolute;
  top: -14px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  background: white;
  border-radius: 12px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
  z-index: 1;
}

.preset-add-button {
  flex-shrink: 0;
  border: 1px dashed $grey-5;
  border-radius: 6px;
  width: 36px;
  height: 36px;
}

.body--dark {
  .preset-item {
    background: $dark;
  }

  .preset-item-actions {
    background: $dark-page;
  }
}
</style>
