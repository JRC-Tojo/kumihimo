/**
 * 関係性登録の待機状態（対になるアノテーション待ち）に関する共通ロジック
 *
 * `DocumentTabView.vue`（連続定義モードでの自動連鎖）と
 * `RelationalDefineButtons.vue`（選択中アノテーションからの新規定義）の両方から使う。
 * 実際のペア確定処理（`finishRelational`等）は選択状態・アノテーション一覧を持つ
 * `DocumentTabView.vue`側に残し、ここでは「待機を開始し、フッターへ通知する」部分のみを共通化する
 */

import type { useI18n } from 'vue-i18n';
import type { useEditorStore } from 'src/stores/editorStore';
import type { ContainerElementFile } from 'src/models/container';
import type { AnnotationID } from 'src/models/document/pdf';
import type { RelationalEndpointID } from 'src/models/relational/fileSchema';
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
 * 指定した端点（アノテーションまたはグループ）を基準に、関係性登録の待機状態を開始する
 */
export function startRelationalDefine(
  editorStore: EditorStore,
  t: I18nT,
  mode: RelationalRuleType,
  endpointId: RelationalEndpointID,
  file: ContainerElementFile,
): void {
  editorStore.relationalMode = mode;
  editorStore.startRelationalPending(endpointId, file);
  showRelationalWaitingNotify(editorStore, t, mode);
}

/** `decideRelationalOnAnnotationsAdded`が返す判定結果 */
export type RelationalAddDecision =
  | { action: 'start'; annotId: AnnotationID }
  | { action: 'finish'; annotId: AnnotationID }
  | undefined;

/**
 * アノテーション一覧に新たに追加された1件をもとに、関係性登録の待機状態をどう
 * 遷移すべきか判定する（`DocumentTabView.vue`がアノテーション一覧の変化を監視する際に使う）
 *
 * 判定は基本的にID差分（新たに追加されたアノテーションのID）のみに基づき、選択状態には
 * 依存しない。これにより、連続描画モードで選択状態の更新が遅れる／伴わない場合でも、
 * 「1つ目の作成で待機開始、2つ目の作成で確定」という連続登録の一連の流れを常に正しく判定できる。
 *
 * ただし`lastPairedId`（直前に確定したペアの対象アノテーションID）だけは例外的に参照する。
 * アノテーション一覧への反映（バックエンド経由の非同期通知）は、選択状態の反映（描画完了時に
 * 直接代入）より遅れて届くことがあるため、2つ目のアノテーションの確定が選択変化側
 * （`decideRelationalOnSelectionChanged`）で先に処理されてしまうケースがある。その場合、
 * この関数が同じアノテーションの追加を検知する時点では待機は既に解除済みで「1つ目の追加」に
 * 見えてしまうが、実際には新しい起点ではなく確定処理の後追い検知にすぎない。これを誤って
 * 新たな起点にしてしまうと、直後に描いた次のアノテーションと即座に関係性が結ばれてしまう
 */
export function decideRelationalOnAnnotationsAdded(
  mode: RelationalRuleType | undefined,
  pendingId: RelationalEndpointID | undefined,
  addedAnnotIds: AnnotationID[],
  lastPairedId: RelationalEndpointID | undefined,
): RelationalAddDecision {
  if (mode === undefined) return undefined;
  if (addedAnnotIds.length !== 1) return undefined; // 1件増えたときのみ対象
  const addedId = addedAnnotIds[0];
  if (addedId === undefined) return undefined;
  if (pendingId !== undefined) return { action: 'finish', annotId: addedId };
  if (addedId === lastPairedId) return undefined; // 確定処理の後追い検知は無視する
  return { action: 'start', annotId: addedId };
}

/**
 * 選択中アノテーションの変化をもとに、待機中の関係性を確定すべきかどうか判定する
 * （`DocumentTabView.vue`が選択状態の変化を監視する際に使う。既存の別アノテーション・グループを
 * 対になる相手として選んだ場合の確定はこちらが担う）
 *
 * `pendingId`がグループの場合、そのグループの全メンバーIDを新しい選択から除外しないと
 * （グループ自身のIDはselectedIdsには現れないため）誤って自分自身を相手として確定してしまう。
 * `resolvePendingMemberIds`はこの除外対象（`pendingId`がグループなら全メンバー、
 * アノテーションならそれ自身1件）を解決するコールバックで、呼び出し側がgroupStoreを
 * 参照して実装する（本関数自体はstore非依存の純粋関数のまま保つため）。
 *
 * 除外後の選択が2件以上残る場合、それが既存グループ全体とちょうど一致するかを
 * `resolveGroupMatch`で判定し、一致すればそのグループを新たな相手として確定する
 * （一致しなければ、相手が一意に定まらないため確定しない）
 */
export function decideRelationalOnSelectionChanged(
  mode: RelationalRuleType | undefined,
  pendingId: RelationalEndpointID | undefined,
  selectedIds: AnnotationID[],
  resolvePendingMemberIds: (id: RelationalEndpointID) => Set<AnnotationID>,
  resolveGroupMatch: (ids: AnnotationID[]) => RelationalEndpointID | undefined,
): RelationalEndpointID | undefined {
  if (mode === undefined || pendingId === undefined) return undefined;
  const excluded = resolvePendingMemberIds(pendingId);
  const targetIds = selectedIds.filter((id) => !excluded.has(id));
  if (targetIds.length === 1) return targetIds[0];
  if (targetIds.length > 1) return resolveGroupMatch(targetIds);
  return undefined;
}

/** `decideRelationalContinuousRestart`が返す判定結果 */
export type RelationalContinuousRestartDecision =
  | { start: false; clearLastPaired: boolean }
  | {
      start: true;
      clearLastPaired: boolean;
      annotId: RelationalEndpointID;
      mode: RelationalRuleType;
    };

/**
 * 連続定義モード中、選択中アノテーションのIDが変化した際に、それを新たな起点として
 * 待機状態を自動的に開始すべきかどうか判定する（`RelationalDefineButtons.vue`が
 * 選択IDの変化を監視する際に使う）
 *
 * `lastPairedId`（直前に確定したペアの対象アノテーションID）と一致する間は、
 * 「対になるアノテーションが選択され続けているだけ」とみなしてスキップする。
 * 呼び出し側は`targetId`にアノテーションオブジェクトそのものではなくIDを渡すこと
 * （アノテーション一覧の更新に伴い参照だけが変化してこの判定が意図せず再実行されるのを防ぐため）
 *
 * `lastPairedId`は`targetId`が別の“定まった”アノテーションに変わった場合のみ解除する。
 * `targetId`が一旦`undefined`になっただけでは解除しない。新規アノテーション作成直後は、
 * 選択IDへの反映（描画完了時に直接代入）がアノテーション一覧への反映（バックエンド経由の
 * 非同期通知）より先に届くため、そのアノテーションが一覧に載るまでの一瞬`activeSelection`
 * （＝`targetId`）が空になる（`DocumentTabView.vue`の`selectedAnnotations`はまだ一覧に
 * 存在しないIDを除外するため）。この一瞬をここで「対象が変わった」と誤認して`lastPairedId`
 * を解除してしまうと、直後に届くその対象アノテーション自身の一覧反映（後追い検知）を
 * `decideRelationalOnAnnotationsAdded`側で正しく無視できなくなり、後追い反映を新たな起点として
 * 誤って待機開始してしまう（＝次にどこかで描いたアノテーションと意図せず関係性が結ばれる）
 */
export function decideRelationalContinuousRestart(params: {
  continuous: boolean;
  pending: boolean;
  mode: RelationalRuleType | undefined;
  targetId: RelationalEndpointID | undefined;
  lastPairedId: RelationalEndpointID | undefined;
}): RelationalContinuousRestartDecision {
  const { continuous, pending, mode, targetId, lastPairedId } = params;
  if (lastPairedId !== undefined && targetId === lastPairedId) {
    return { start: false, clearLastPaired: false };
  }
  const clearLastPaired = lastPairedId !== undefined && targetId !== undefined;
  if (!continuous || pending || targetId === undefined || mode === undefined) {
    return { start: false, clearLastPaired };
  }
  return { start: true, clearLastPaired, annotId: targetId, mode };
}
