<template>
  <div v-if="visible" class="relational-define-buttons">
    <q-separator vertical inset class="style-separator" />
    <template v-if="isPending">
      <q-btn
        dense
        flat
        :ripple="false"
        icon="link_off"
        color="negative"
        class="style-icon-btn"
        @click="onCancel"
      >
        <q-tooltip anchor="top middle" self="bottom middle">
          {{ t('pdfEditor.tools.relational.cancel') }}
        </q-tooltip>
      </q-btn>
    </template>
    <template v-else-if="target">
      <q-btn
        dense
        flat
        :ripple="false"
        icon="sync_alt"
        :outline="editorStore.relationalMode === 'equal'"
        class="style-icon-btn"
        @click="onDefine('equal')"
      >
        <q-tooltip anchor="top middle" self="bottom middle">
          {{ t('pdfEditor.tools.relational.defineEqual') }}
        </q-tooltip>
      </q-btn>
      <q-btn
        dense
        flat
        :ripple="false"
        icon="link"
        :outline="editorStore.relationalMode === 'link'"
        class="style-icon-btn"
        @click="onDefine('link')"
      >
        <q-tooltip anchor="top middle" self="bottom middle">
          {{ t('pdfEditor.tools.relational.defineLink') }}
        </q-tooltip>
      </q-btn>
      <q-btn dense flat :ripple="false" icon="tune" class="style-icon-btn" @click="onOpenSettings">
        <q-tooltip anchor="top middle" self="bottom middle">
          {{ t('pdfEditor.tools.relational.openSettings') }}
        </q-tooltip>
      </q-btn>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 選択中アノテーションから関係性を定義するための操作盤（常駐SubTools行に表示する）
 *
 * `AnnotationPositionSizeBtn.vue`と同じく、単一のアノテーションを選択している時だけ表示する。
 * 「等しい」「リンク」のいずれかをクリックすると、そのアノテーションを基準に対になる
 * アノテーションの待機状態を開始する（実際のペア確定処理は`DocumentTabView.vue`が
 * `editorStore.relationalPendingId`等のグローバルな状態を見て行う）。待機中は選択状態に
 * 関わらずキャンセルボタンのみを表示し、いつでも待機を中断できるようにする
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useEditorStore } from 'src/stores/editorStore';
import { startRelationalDefine } from './composables/useRelationalDefine';
import type { RelationalRuleType } from 'src/models/relational/ruleUtils';
import type { AnnotationStyle } from 'src/models/document/pdf';

const { t } = useI18n();
const editorStore = useEditorStore();

/** 単一選択時のみ対象とする（複数選択時はどのアノテーションを基準にするか一意に決まらないため対象外） */
const target = computed<AnnotationStyle | undefined>(() => {
  const annots = editorStore.activeSelection?.annotations;
  return annots?.length === 1 ? annots[0] : undefined;
});

const isPending = computed(() => editorStore.relationalPendingId !== undefined);
// 待機中は、選択が外れて`target`が無くなってもキャンセルボタンを表示し続ける
const visible = computed(() => target.value !== undefined || isPending.value);

function onDefine(mode: RelationalRuleType) {
  const annot = target.value;
  const file = editorStore.activeSelection?.file;
  if (!annot || !file) return;
  startRelationalDefine(editorStore, t, mode, annot.id, file);
}

function onCancel() {
  editorStore.cancelRelationalMode();
}

function onOpenSettings() {
  editorStore.requestSettingsScroll('relational');
}
</script>

<style scoped lang="scss">
.relational-define-buttons {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  flex-shrink: 0;
}

.style-icon-btn {
  min-height: 24px;
  min-width: 28px;
  padding: 0 0.3rem;
}

.style-separator {
  height: 20px;
}
</style>
