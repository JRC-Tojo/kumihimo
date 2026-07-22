import z from 'zod';
import { PluginManifest } from './manifest';

export const PluginSubmissionID = z.uuidv4().brand('PluginSubmissionID');
export type PluginSubmissionID = z.infer<typeof PluginSubmissionID>;

/**
 * プラグイン申請の状態
 *
 * pending: 申請直後、CI検証待ち（アプリ内ではモックで模擬する）
 * ci_passed / ci_failed: CI検証の結果
 * published: 公開済み
 */
export const PluginSubmissionStatus = z.enum(['pending', 'ci_passed', 'ci_failed', 'published']);
export type PluginSubmissionStatus = z.infer<typeof PluginSubmissionStatus>;

/**
 * プラグイン申請
 *
 * 実際のGitHub PR/CIは存在しないため、`services/plugin/submissionMock.ts`が
 * 状態遷移をアプリ内で模擬する（詳細は同ファイルのコメント参照）
 */
export const PluginSubmission = z.object({
  id: PluginSubmissionID,
  manifest: PluginManifest,
  status: PluginSubmissionStatus,
  ciLog: z.string().optional(),
  submittedAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type PluginSubmission = z.infer<typeof PluginSubmission>;
