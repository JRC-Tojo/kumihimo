import z from 'zod';
import { PluginManifest } from './manifest';

/**
 * プラグイン申請の状態
 *
 * pending: PRのCIチェックが実行中・未完了
 * ci_passed: CIチェックがすべて成功（マージ待ち。マージはリポジトリのメンテナが行う）
 * ci_failed: いずれかのCIチェックが失敗
 * published: PRがマージ済み
 *
 * これらはすべて、ストアリポジトリの実際のPull Request・Checks APIから都度導出する
 * （アプリ側では状態を保持しない。GitHubが唯一の情報源）
 */
export const PluginSubmissionStatus = z.enum(['pending', 'ci_passed', 'ci_failed', 'published']);
export type PluginSubmissionStatus = z.infer<typeof PluginSubmissionStatus>;

/**
 * プラグイン申請（＝ストアリポジトリに対する実際のPull Request）
 */
export const PluginSubmission = z.object({
  manifest: PluginManifest,
  status: PluginSubmissionStatus,
  prNumber: z.number().int().positive(),
  prUrl: z.url(),
  // フォーク元（提出者）のGitHubユーザー名とブランチ名。再申請時に同じブランチへコミットを積む
  headOwner: z.string(),
  headBranch: z.string(),
  // CIチェックの詳細（成否と名称）。UIでの表示用
  checks: z
    .object({
      name: z.string(),
      conclusion: z.string().nullable(),
    })
    .array()
    .default([]),
  submittedAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type PluginSubmission = z.infer<typeof PluginSubmission>;
