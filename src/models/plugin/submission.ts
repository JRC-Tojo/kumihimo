import z from 'zod';
import { PluginManifest } from './manifest';

/**
 * プラグイン申請の状態
 *
 * pending: PRのCIチェックが実行中・未完了
 * ci_passed: CIチェック（manifest/wasm/icon/ownership）がすべて成功。ストアリポジトリの
 *   Actionsが自動的にマージするため、通常はこの状態に長く留まらない
 * ci_failed: いずれかのCIチェックが失敗。修正した内容を同じPRへ再度申請できる
 * published: PRがマージ済み
 * withdrawn: マージされずにPRがクローズされた（申請者自身が取り下げた場合など）
 *
 * これらはすべて、ストアリポジトリの実際のPull Request・Checks APIから都度導出する
 * （アプリ側では状態を保持しない。GitHubが唯一の情報源）
 */
export const PluginSubmissionStatus = z.enum([
  'pending',
  'ci_passed',
  'ci_failed',
  'published',
  'withdrawn',
]);
export type PluginSubmissionStatus = z.infer<typeof PluginSubmissionStatus>;

/**
 * 申請の種別
 *
 * submit: 新規申請・バージョン更新（`plugin/<id>`ブランチ）
 * unpublish: 公開済みプラグインの取り下げ（`deprecated: true`にする。`unpublish/<id>`ブランチ）
 *
 * 同一プラグインについて、submit/unpublishそれぞれ最大1件のPRしか同時に開かない設計とする
 * （両ブランチとも固定名で、既存の開いたPRがあれば新規作成せず再利用する）ため、
 * UI側は「進行中のsubmit申請があるあいだはunpublishできない・その逆も同様」という
 * 相互排他を利用者に示すためにこの`kind`を使う
 */
export const PluginSubmissionKind = z.enum(['submit', 'unpublish']);
export type PluginSubmissionKind = z.infer<typeof PluginSubmissionKind>;

/**
 * ストア申請時に開発者が入力する最小限の情報（`id`/`owner`/`deprecated`を持たない）
 *
 * 完全な`PluginManifest`（`plugin.json`相当）は、`id`（新規採番 or 既存id）と`owner`
 * （申請者のGitHubログイン名）が判明するsubmitPlugin内で初めて組み立てる。開発者に
 * `plugin.json`を手書きさせない設計にしたため、この2フィールドは常にアプリ側が決定する
 */
export const PluginSubmissionDraft = PluginManifest.omit({
  id: true,
  owner: true,
  deprecated: true,
});
export type PluginSubmissionDraft = z.infer<typeof PluginSubmissionDraft>;

/**
 * プラグイン申請（＝ストアリポジトリに対する実際のPull Request）
 */
export const PluginSubmission = z.object({
  manifest: PluginManifest,
  kind: PluginSubmissionKind,
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
