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
    >
      <AnnotationPresetPreview :annotation-style="preset.style" />
      <q-tooltip :delay="400">{{ preset.name }}</q-tooltip>

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
 * `editorStore.activeAnnotationType`に対応するプリセットのみを表示する。プリセットは
 * ビジュアルプレビュー（AnnotationPresetPreview）のみを表示し、名前はTooltipで示す。
 * ドラッグ並び替え・追加・名前変更・現在スタイルへの更新・削除をサポートする
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { v4 as uuidv4 } from 'uuid';
import { type MoveEvent, VueDraggable } from 'vue-draggable-plus';
import AnnotationPresetPreview from './AnnotationPresetPreview.vue';
import { useEditorStore } from 'src/stores/editorStore';
import { useSettingsStore } from 'src/stores/settingsStore';
import type { AnnotationTool } from 'src/models/docPage';
import { reorderPresetsOfType } from './composables/useAnnotationPresets';
import { confirmDialog, promptDialog } from 'src/components/Dialog/confirmDialog';

const { t } = useI18n();
const $q = useQuasar();
const editorStore = useEditorStore();
const settingsStore = useSettingsStore();

const allPresets = computed(() => settingsStore.appSettings?.tools.annotations ?? []);

const presetsForType = computed<AnnotationTool[]>({
  get: () => {
    const type = editorStore.activeAnnotationType;
    return type === undefined ? [] : allPresets.value.filter((p) => p.style.type === type);
  },
  set: (reordered) => {
    const type = editorStore.activeAnnotationType;
    if (type === undefined) return;
    void settingsStore.updateAnnotationPresets(
      reorderPresetsOfType(allPresets.value, type, reordered),
    );
  },
});

const handleMove = (evt: MoveEvent) => {
  // 割り込み先の要素が .drag-disabled を持っていたら移動をキャンセル
  if (evt.related && evt.related.classList.contains('drag-disabled')) {
    return false;
  }
};

/** 現在のcurrentAnnotationStyleと一致するプリセットをハイライトする（内容までstringifyして比較） */
function isActivePreset(preset: AnnotationTool): boolean {
  return JSON.stringify(editorStore.currentAnnotationStyle) === JSON.stringify(preset.style);
}

function applyPreset(preset: AnnotationTool) {
  editorStore.currentTools = preset.style.type;
  editorStore.currentAnnotationStyle = preset.style;
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
  const newList = allPresets.value.map((p) =>
    p.id === preset.id ? { ...p, style: editorStore.currentAnnotationStyle } : p,
  );
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
  const type = editorStore.activeAnnotationType;
  if (type === undefined) return;

  const defaultName = `${t(`pdfEditor.tools.${type}`)} ${presetsForType.value.length + 1}`;
  const name = await promptDialog({
    title: t('pdfEditor.tools.presetBar.add'),
    promptLabel: t('pdfEditor.tools.presetBar.nameLabel'),
    initialValue: defaultName,
  });
  if (name === undefined || name.trim() === '') return;

  const newPreset: AnnotationTool = {
    id: uuidv4(),
    name,
    style: editorStore.currentAnnotationStyle,
  };
  await settingsStore.updateAnnotationPresets([...allPresets.value, newPreset]);
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
