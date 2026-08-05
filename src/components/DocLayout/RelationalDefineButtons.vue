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
      @dblclick="onDefineDouble(relMode.type)"
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
 * シングルクリック時は、そのアノテーションを基準に対になるアノテーションの待機状態を開始し、
 * 1組確定すると待機は解除される（実際のペア確定処理は`DocumentTabView.vue`が
 * `editorStore.relationalPendingId`等のグローバルな状態を見て行う）。待機中にクリックした場合は
 * 待機状態を維持したまま種別だけを切り替える（種別の確認・変更を待機中でも行えるようにするため）。
 * ダブルクリック時は、MainToolsの連続描画モード（stickyDrawMode）と同様に連続定義モード
 * （`editorStore.relationalContinuous`）を有効にする。有効な間は、対になるアノテーションを
 * 選択して1組確定すると一旦待機は解除されるが（起点をリセット）、その後に選択された
 * 次のアノテーションを新たな起点として自動的に待機を再開する（`targetId`の変化を監視して行う。
 * 直前の対象とそのまま連鎖させるのではなく、次の選択を独立した新しいペアの起点として扱う）。
 * ユーザーが明示的にキャンセルボタンを押すまで有効であり続ける。
 * 末尾の1枠（設定ショートカット／キャンセル）だけが待機中かどうかで入れ替わり、
 * それ以外のボタン配置は変化しない
 */
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useEditorStore } from 'src/stores/editorStore';
import {
  startRelationalDefine,
  showRelationalWaitingNotify,
  decideRelationalContinuousRestart,
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

// 監視対象はアノテーションのIDのみとする。`target`（アノテーションオブジェクトそのもの）を
// 直接監視すると、選択自体は変わっていなくても、他のアノテーションの内容更新（OCR結果の反映等）
// によって参照だけが新しくなるたびに監視コールバックが再実行されてしまう
const targetId = computed(() => target.value?.id);

const isPending = computed(() => editorStore.relationalPendingId !== undefined);
// 待機中は、選択が外れて`target`が無くなっても操作盤を表示し続ける（種別の確認・キャンセルのため）
const visible = computed(() => target.value !== undefined || isPending.value);

const relationalModes = [
  { type: 'equal', icon: 'sync_alt' },
  { type: 'link', icon: 'link' },
] as { type: RelationalRuleType; icon: string }[];

/**
 * 「等しい」「リンク」ボタンのシングルクリック処理
 *
 * 未待機時は選択中のアノテーションを基準に対になるアノテーションの待機状態を開始し、
 * 待機中はそのまま種別だけを切り替える（種別の確認・変更を待機中でも行えるようにするため）
 */
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

/**
 * ダブルクリック：MainToolsの連続描画モード（stickyDrawMode）と同様、`onDefine`と同じ処理を
 * 冪等に行った上で連続定義モードを有効にする（DOM仕様上clickが2回発火してからdblclickが
 * 発火するため、先に単発の開始/切り替えは済んでいる状態でこれが呼ばれる）。
 * ユーザーが明示的にキャンセルボタンを押すまで有効であり続ける
 */
function onDefineDouble(mode: RelationalRuleType) {
  onDefine(mode);
  editorStore.relationalContinuous = true;
}

/**
 * 連続定義モード中、1組確定して待機が解除された後に選ばれた次のアノテーションを、
 * 新たな起点として自動的に待機状態にする（クリックし直す必要をなくす）。
 *
 * 注意: ペア確定直後は「対象アノテーションが選択され続けているだけ」の状態でも、選択ID自体は
 * 変わっていないのに`editorStore.relationalLastPairedId`（ペア確定時に`finishRelational`が
 * 刻む目印）と一致する間はスキップする必要がある。これをそのまま新たな起点にしてしまうと、
 * 直前の対象と自動で連鎖する「チェーン」的な挙動になってしまい、「対になるアノテーションが
 * 選択された後は起点をリセットしてよい」という意図に反するため
 */
watch(targetId, (id) => {
  const decision = decideRelationalContinuousRestart({
    continuous: editorStore.relationalContinuous,
    pending: isPending.value,
    mode: editorStore.relationalMode,
    targetId: id,
    lastPairedId: editorStore.relationalLastPairedId,
  });
  if (decision.clearLastPaired) editorStore.relationalLastPairedId = undefined;
  if (!decision.start) return;

  const file = editorStore.activeSelection?.file;
  if (!file) return;
  startRelationalDefine(editorStore, t, decision.mode, decision.annotId, file);
});

/**
 * 関係性登録モードを終了する（待機中の状態・連続定義モードも解除する）
 */
function onCancel() {
  editorStore.cancelRelationalMode();
}

/**
 * 設定タブを開き、関係性検証スタイルのセクションへ自動スクロールする
 */
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
