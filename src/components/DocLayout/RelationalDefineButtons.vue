<template>
  <div v-if="visible" class="relational-define-buttons">
    <q-separator vertical inset class="style-separator" />
    <q-btn
      v-for="relMode in relationalModes"
      :key="relMode.type"
      :data-testid="`relational-define-${relMode.type}`"
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

    <!-- 待機中・連続定義モード中はキャンセルボタン、そうでなければ設定ショートカットボタン。
         連続定義モードはペア確定直後で待機中でない間も有効であり続けるため、`isPending`だけで
         判定すると、その間だけキャンセルボタンが消えてしまい、連続モードを解除する手段が
         見えなくなる（誤ってダブルクリックした場合等に気付けず、次に描いたアノテーションが
         新たな起点になり続けてしまう）。この1枠だけが入れ替わり、等しい/リンクボタンの配置は
         待機中かどうかに関わらず変化しない -->
    <q-btn
      v-if="isPending || editorStore.relationalContinuous"
      dense
      flat
      :ripple="false"
      icon="link_off"
      color="negative"
      class="style-icon-btn"
      @click="onCancel"
    >
      <q-tooltip anchor="top middle" self="bottom middle">
        {{
          isPending
            ? t('pdfEditor.tools.relational.cancel')
            : t('pdfEditor.tools.relational.cancelContinuous')
        }}
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
 * 単一のアノテーションを選択している時、または選択が既存グループの全メンバーとちょうど
 * 一致する時（この場合はグループ自身が起点になる）だけ表示する。それ以外の複数選択
 * （部分グループ・複数のばらのアノテーション等）はどの端点を基準にするか一意に決まらないため
 * 対象外とする。「等しい」「リンク」ボタンは、待機中かどうかに関わらず常に同じ位置に表示する。
 * シングルクリック時は、その端点（アノテーションまたはグループ）を基準に対になる相手の待機状態を開始し、
 * 1組確定すると待機は解除される（実際のペア確定処理は`DocumentTabView.vue`が
 * `editorStore.relationalPendingId`等のグローバルな状態を見て行う）。待機中にクリックした場合は
 * 待機状態を維持したまま種別だけを切り替える（種別の確認・変更を待機中でも行えるようにするため）。
 * ダブルクリック時は、MainToolsの連続描画モード（stickyDrawMode）と同様に連続定義モード
 * （`editorStore.relationalContinuous`）を有効にする。有効な間は、対になるアノテーションを
 * 選択して1組確定すると一旦待機は解除されるが（起点をリセット）、その後に選択された
 * 次のアノテーションを新たな起点として自動的に待機を再開する（`targetId`の変化を監視して行う。
 * 直前の対象とそのまま連鎖させるのではなく、次の選択を独立した新しいペアの起点として扱う）。
 * ユーザーが明示的にキャンセルボタンを押すまで有効であり続ける。
 * 末尾の1枠（設定ショートカット／キャンセル）は、待機中または連続定義モード中に
 * キャンセルボタンへ入れ替わり、それ以外のボタン配置は変化しない。連続定義モードは
 * ペア確定直後（待機中でない間）も有効であり続けるため、`isPending`だけで判定すると
 * その間だけキャンセルボタンが消え、連続モードを解除する手段が見えなくなってしまう。
 */
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useEditorStore } from 'src/stores/editorStore';
import { useGroupStore } from 'src/stores/groupStore';
import { fileKey } from 'src/utils/document/fileKey';
import {
  startRelationalDefine,
  showRelationalWaitingNotify,
  decideRelationalContinuousRestart,
} from './composables/useRelationalDefine';
import type { RelationalRuleType } from 'src/models/relational/ruleUtils';
import type { RelationalEndpointID } from 'src/models/relational/fileSchema';

const { t } = useI18n();
const editorStore = useEditorStore();
const groupStore = useGroupStore();

/**
 * 関係性定義の起点として一意に定まる場合のみ対象とする：選択がアノテーション1件、
 * または選択が既存グループの全メンバーとちょうど一致する場合（この場合はグループ自身が起点になる）。
 * それ以外の複数選択（部分グループ・複数のばらのアノテーション等）は、どの端点を基準にするか
 * 一意に決まらないため対象外とする（`DocumentTabView.vue`のresolvePeekTargetと同じ判定方針）
 */
const targetId = computed<RelationalEndpointID | undefined>(() => {
  const sel = editorStore.activeSelection;
  if (sel === undefined) return undefined;
  const annots = sel.annotations;
  if (annots.length === 1) return annots[0]!.id;
  if (annots.length > 1) {
    return groupStore.matchingGroup(
      fileKey(sel.file),
      annots.map((a) => a.id),
    )?.id;
  }
  return undefined;
});

const isPending = computed(() => editorStore.relationalPendingId !== undefined);
// 待機中・連続定義モード中は、選択が外れて`targetId`が無くなっても操作盤を表示し続ける
// （種別の確認・キャンセルのため。特に連続定義モードはペア確定直後も有効であり続けるため、
// ここに含めないと選択が外れた瞬間キャンセルボタンごと操作盤が消え、解除できなくなる）
const visible = computed(
  () => targetId.value !== undefined || isPending.value || editorStore.relationalContinuous,
);

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

  const endpointId = targetId.value;
  const file = editorStore.activeSelection?.file;
  if (endpointId === undefined || !file) return;
  startRelationalDefine(editorStore, t, mode, endpointId, file);
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
