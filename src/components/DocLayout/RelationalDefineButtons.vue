<template>
  <div v-if="visible" class="relational-define-buttons">
    <q-separator vertical inset class="style-separator" />
    <q-btn
      v-for="relMode in relationalModes"
      :key="relMode.type"
      dense
      :flat="editorStore.relationalMode !== relMode.type"
      :ripple="false"
      :icon="relMode.icon"
      :color="editorStore.relationalMode === relMode.type ? 'primary' : ''"
      :outline="editorStore.relationalMode === relMode.type"
      class="style-icon-btn"
      @click="onDefine(relMode.type)"
    >
      <q-tooltip anchor="top middle" self="bottom middle">
        {{ t(`pdfEditor.tools.relational.define${relMode.type}`) }}
      </q-tooltip>
    </q-btn>

    <!-- 待機中はキャンセルボタン、そうでなければ設定ショートカットボタン。この1枠だけが入れ替わり、
         等しい/リンクボタンの配置は待機中かどうかに関わらず変化しない -->
    <q-btn
      v-if="isPending"
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
    <q-btn
      v-else
      dense
      flat
      :ripple="false"
      icon="tune"
      class="style-icon-btn"
      @click="onOpenSettings"
    >
      <q-tooltip anchor="top middle" self="bottom middle">
        {{ t('pdfEditor.tools.relational.openSettings') }}
      </q-tooltip>
    </q-btn>
  </div>
</template>

<script setup lang="ts">
/**
 * 選択中アノテーションから関係性を定義するための操作盤（常駐SubTools行に表示する）
 *
 * `AnnotationPositionSizeBtn.vue`と同じく、単一のアノテーションを選択している時だけ表示する。
 * 「等しい」「リンク」ボタンは、待機中かどうかに関わらず常に同じ位置に表示する。
 * 未待機時にクリックすると、そのアノテーションを基準に対になるアノテーションの待機状態を
 * 開始する（実際のペア確定処理は`DocumentTabView.vue`が`editorStore.relationalPendingId`等の
 * グローバルな状態を見て行う）。待機中にクリックした場合は待機状態を維持したまま種別だけを
 * 切り替える（種別の確認・変更を待機中でも行えるようにするため）。
 * 末尾の1枠（設定ショートカット／キャンセル）だけが待機中かどうかで入れ替わり、
 * それ以外のボタン配置は変化しない
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useEditorStore } from 'src/stores/editorStore';
import {
  startRelationalDefine,
  showRelationalWaitingNotify,
} from './composables/useRelationalDefine';
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
// 待機中は、選択が外れて`target`が無くなっても操作盤を表示し続ける（種別の確認・キャンセルのため）
const visible = computed(() => target.value !== undefined || isPending.value);

const relationalModes = [
  { type: 'equal', icon: 'sync_alt' },
  { type: 'link', icon: 'link' },
] as { type: RelationalRuleType; icon: string }[];

function onDefine(mode: RelationalRuleType) {
  if (isPending.value) {
    // 待機中は待機状態を維持したまま種別だけ切り替える
    editorStore.relationalMode = mode;
    showRelationalWaitingNotify(editorStore, t, mode);
    return;
  }

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
  min-height: 28px;
  min-width: 28px;
  padding: 0 0.3rem;
}

.style-separator {
  height: 20px;
}
</style>
