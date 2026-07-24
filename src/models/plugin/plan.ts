import z from 'zod';
import { ContainerID } from 'src/models/container';
import { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import { Relational } from 'src/models/relational/common';

/**
 * プラグインが書き込み予定（`plan`）に積んだ項目をどう確定させるか
 *
 * 'once': そのラン全体で一度だけ、内容の要約を示す確認ダイアログを表示する
 * 'perItem': プラグインタブ内で1件ずつ承認/却下する
 *
 * WASMのホスト関数は同期呼び出しのため、呼び出し中にユーザーの確認を待機できない。
 * そのため実行（plan段階）と確定（commit段階）を分離し、`plan.setConfirmationMode`の
 * 呼び出しタイミングでプラグイン自身がこのモードを自由に制御できるようにしている
 */
export const PluginConfirmationMode = z.enum(['once', 'perItem']);
export type PluginConfirmationMode = z.infer<typeof PluginConfirmationMode>;

export const PluginPlanItemStatus = z.enum(['planned', 'approved', 'rejected', 'committed']);
export type PluginPlanItemStatus = z.infer<typeof PluginPlanItemStatus>;

const PluginPlanItemBase = z.object({
  id: z.string(),
  confirmationMode: PluginConfirmationMode,
  status: PluginPlanItemStatus,
});

const PluginFileRef = z.object({
  containerID: ContainerID,
  path: z.string(),
});

export const PluginPlanAnnotationCreateItem = PluginPlanItemBase.extend({
  kind: z.literal('annotationCreate'),
  file: PluginFileRef,
  style: AnnotationStyle,
});
export type PluginPlanAnnotationCreateItem = z.infer<typeof PluginPlanAnnotationCreateItem>;

export const PluginPlanAnnotationUpdateItem = PluginPlanItemBase.extend({
  kind: z.literal('annotationUpdate'),
  file: PluginFileRef,
  annotId: AnnotationID,
  style: AnnotationStyle,
});
export type PluginPlanAnnotationUpdateItem = z.infer<typeof PluginPlanAnnotationUpdateItem>;

export const PluginPlanAnnotationRemoveItem = PluginPlanItemBase.extend({
  kind: z.literal('annotationRemove'),
  file: PluginFileRef,
  annotId: AnnotationID,
});
export type PluginPlanAnnotationRemoveItem = z.infer<typeof PluginPlanAnnotationRemoveItem>;

export const PluginPlanRelationalCreateItem = PluginPlanItemBase.extend({
  kind: z.literal('relationalCreate'),
  relational: Relational,
});
export type PluginPlanRelationalCreateItem = z.infer<typeof PluginPlanRelationalCreateItem>;

export const PluginPlanRelationalRemoveItem = PluginPlanItemBase.extend({
  kind: z.literal('relationalRemove'),
  srcId: AnnotationID,
  targetId: AnnotationID,
});
export type PluginPlanRelationalRemoveItem = z.infer<typeof PluginPlanRelationalRemoveItem>;

/**
 * プラグインが1回の実行中に積んだ書き込み予定1件分
 *
 * commit時（`services/plugin/run.ts`の`approvePlanItems`）は`kind`に応じて既存のサービス関数
 * （`registerAnnotationStyle`/`removeAnnotation`相当/`registRelational`/`removeRelationalEdge`）
 * へ振り分けるのみで、新規の永続化ロジックは持たない
 */
export const PluginPlanItem = z.discriminatedUnion('kind', [
  PluginPlanAnnotationCreateItem,
  PluginPlanAnnotationUpdateItem,
  PluginPlanAnnotationRemoveItem,
  PluginPlanRelationalCreateItem,
  PluginPlanRelationalRemoveItem,
]);
export type PluginPlanItem = z.infer<typeof PluginPlanItem>;
