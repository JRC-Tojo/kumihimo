<template>
  <Teleport to="body">
    <!--
      PdfPage.vueがズーム表示のためCSS transformを親要素に適用しているため、そのまま
      position: fixedで配置すると新しい包含ブロックの影響でズレる。<Teleport>でbody直下へ
      逃がすことで、右クリック時のclientX/clientY（真の画面座標）どおりに配置できるようにする
    -->
    <div
      class="context-menu-anchor"
      :style="{ position: 'fixed', left: `${clientPos.x}px`, top: `${clientPos.y}px` }"
    >
      <q-menu :model-value="true" anchor="top left" self="top left" @hide="emit('close')">
        <q-list dense style="min-width: 220px">
          <q-item v-close-popup clickable @click="onCopy">
            <q-item-section>{{ t('pdfEditor.tools.contextMenu.copy') }}</q-item-section>
          </q-item>

          <q-item clickable>
            <q-item-section>{{ t('pdfEditor.tools.layerOrder.title') }}</q-item-section>
            <q-item-section side>
              <q-icon name="chevron_right" />
            </q-item-section>
            <q-menu anchor="top end" self="top start">
              <q-list dense>
                <q-item v-close-popup clickable @click="onReorder('front')">
                  <q-item-section>{{ t('pdfEditor.tools.layerOrder.bringToFront') }}</q-item-section>
                </q-item>
                <q-item v-close-popup clickable @click="onReorder('forward')">
                  <q-item-section>{{ t('pdfEditor.tools.layerOrder.bringForward') }}</q-item-section>
                </q-item>
                <q-item v-close-popup clickable @click="onReorder('backward')">
                  <q-item-section>{{ t('pdfEditor.tools.layerOrder.sendBackward') }}</q-item-section>
                </q-item>
                <q-item v-close-popup clickable @click="onReorder('back')">
                  <q-item-section>{{ t('pdfEditor.tools.layerOrder.sendToBack') }}</q-item-section>
                </q-item>
              </q-list>
            </q-menu>
          </q-item>

          <q-separator />

          <q-item v-if="presetsForType.length > 0" clickable>
            <q-item-section>{{ t('pdfEditor.tools.contextMenu.applyPreset') }}</q-item-section>
            <q-item-section side>
              <q-icon name="chevron_right" />
            </q-item-section>
            <q-menu anchor="top end" self="top start">
              <q-list dense>
                <q-item
                  v-for="preset in presetsForType"
                  :key="preset.id"
                  v-close-popup
                  clickable
                  @click="onApplyPreset(preset)"
                >
                  <q-item-section avatar>
                    <AnnotationPresetPreview :annotation-style="preset.style" />
                  </q-item-section>
                  <q-item-section>{{ preset.name }}</q-item-section>
                </q-item>
              </q-list>
            </q-menu>
          </q-item>

          <q-item v-close-popup clickable @click="onRegisterPreset">
            <q-item-section>{{ t('pdfEditor.tools.contextMenu.registerPreset') }}</q-item-section>
          </q-item>
        </q-list>
      </q-menu>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * アノテーション右クリックのコンテキストメニュー
 *
 * 右クリックされた注釈本体を常に対象にする（選択状態に依存しない）ため、
 * プリセット登録時に描画モード側のスタイルで上書きされてしまう心配がない
 * （MainToolsポップアップ経由の登録バグの根本原因については`useAnnotationStylePanel`の
 * mode判定・editorTools.tsのonClicked参照）
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useEditorStore } from 'src/stores/editorStore';
import { useSettingsStore } from 'src/stores/settingsStore';
import type { AnnotationStyle } from 'src/models/document/pdf';
import type { AnnotationTool } from 'src/models/docPage';
import type { LayerOrderAction } from 'src/utils/document/annotationOrder';
import { useAnnotationStylePanel } from 'src/components/DocLayout/composables/useAnnotationStylePanel';
import {
  annotationStyleToPresetStyle,
} from 'src/components/DocLayout/composables/useAnnotationPresets';
import { registerAnnotationPreset } from 'src/components/DocLayout/composables/useAnnotationPresetRegistration';
import AnnotationPresetPreview from 'src/components/DocLayout/AnnotationPresetPreview.vue';

interface Props {
  annotation: AnnotationStyle;
  clientPos: { x: number; y: number };
}
const props = defineProps<Props>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const editorStore = useEditorStore();
const settingsStore = useSettingsStore();
const { applyPresetStyleToSelection } = useAnnotationStylePanel();

const presetsForType = computed<AnnotationTool[]>(() =>
  (settingsStore.appSettings?.tools.annotations ?? []).filter(
    (p) => p.style.type === props.annotation.type,
  ),
);

function onCopy() {
  const targets = editorStore.activeSelection?.annotations ?? [props.annotation];
  editorStore.setAnnotationClipboard(targets);
}

function onReorder(action: LayerOrderAction) {
  editorStore.requestLayerOrder(action);
}

function onApplyPreset(preset: AnnotationTool) {
  void applyPresetStyleToSelection(preset.style);
}

function onRegisterPreset() {
  // 選択状態に関わらず、右クリックされた注釈1件のみを対象にする（一意なため曖昧さがない）
  void registerAnnotationPreset(t, settingsStore, annotationStyleToPresetStyle(props.annotation));
}
</script>
