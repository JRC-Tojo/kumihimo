/**
 * 関係性登録の待機状態（対になるアノテーション待ち）に関する共通ロジック
 *
 * `DocumentTabView.vue`（RightDrawerの「リンクを追加」ボタン経由）と
 * `RelationalDefineButtons.vue`（選択中アノテーションからの新規定義）の両方から使う。
 * 実際のペア確定処理（`finishRelational`等）は選択状態・アノテーション一覧を持つ
 * `DocumentTabView.vue`側に残し、ここでは「待機を開始し、フッターへ通知する」部分のみを共通化する
 */

import type { useI18n } from 'vue-i18n';
import type { useEditorStore } from 'src/stores/editorStore';
import type { ContainerElementFile } from 'src/models/container';
import type { AnnotationID } from 'src/models/document/pdf';
import type { RelationalRuleType } from 'src/models/relational/ruleUtils';

type EditorStore = ReturnType<typeof useEditorStore>;
type I18nT = ReturnType<typeof useI18n>['t'];

/**
 * フッターのステータスメッセージ領域へ関係性モードの待機メッセージを投稿する際に使うキー
 */
export const RELATIONAL_STATUS_MESSAGE_KEY = 'relational-waiting';

/**
 * 待機中の関係性モードに応じた通知メッセージを組み立てる
 */
export function relationalWaitingMessage(t: I18nT, mode: RelationalRuleType): string {
  const modeLabel =
    mode === 'equal' ? t('pdfEditor.tools.relational.equal') : t('pdfEditor.tools.relational.link');
  return t('pdfEditor.tools.relational.waitingMessage', { mode: modeLabel });
}

/**
 * 対になるアノテーションの待機メッセージを、フッターのステータスメッセージ領域へ表示・更新する
 * モード変更時にも再度呼び出すことでメッセージ内容を最新化する
 */
export function showRelationalWaitingNotify(
  editorStore: EditorStore,
  t: I18nT,
  mode: RelationalRuleType,
): void {
  editorStore.postStatusMessage(RELATIONAL_STATUS_MESSAGE_KEY, relationalWaitingMessage(t, mode));
}

/**
 * 指定アノテーションを基準に、関係性登録の待機状態を開始する
 */
export function startRelationalDefine(
  editorStore: EditorStore,
  t: I18nT,
  mode: RelationalRuleType,
  annotId: AnnotationID,
  file: ContainerElementFile,
): void {
  editorStore.relationalMode = mode;
  editorStore.startRelationalPending(annotId, file);
  showRelationalWaitingNotify(editorStore, t, mode);
}
