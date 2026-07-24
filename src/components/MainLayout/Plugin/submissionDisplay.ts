/**
 * `PluginSubmission`を画面表示する際の共通ロジック（`PluginSubmissionItem.vue`・
 * `PluginSubmissionGroup.vue`の両方から参照する）
 */
import type { PluginSubmission, PluginSubmissionStatus } from 'src/models/plugin/submission';

/**
 * 表示用に補正したステータスを返す
 *
 * `submission.status`はPR自体の状態（`deriveStatus`がマージ済みか否か等から導出したもの）で、
 * 申請の種別（`kind`）を考慮しない。そのため取り下げ（`kind: 'unpublish'`）申請がマージされた
 * 場合、PRとしては`'published'`（マージ済み）だが、プラグインの状態としては
 * 「取り下げが完了した」ことを意味する。表示上の意味が逆転してしまうため、ここで
 * `kind`に応じて`'withdrawn'`へ補正する
 */
export function displayStatus(submission: PluginSubmission): PluginSubmissionStatus {
  if (submission.kind === 'unpublish' && submission.status === 'published') return 'withdrawn';
  return submission.status;
}

const STATUS_LABEL_KEYS: Record<PluginSubmissionStatus, string> = {
  pending: 'plugins.submission.status.pending',
  ci_passed: 'plugins.submission.status.ciPassed',
  ci_failed: 'plugins.submission.status.ciFailed',
  published: 'plugins.submission.status.published',
  withdrawn: 'plugins.submission.status.withdrawn',
};

/** i18nキー（`$t()`にそのまま渡す） */
export function statusLabelKey(status: PluginSubmissionStatus): string {
  return STATUS_LABEL_KEYS[status];
}

const STATUS_COLORS: Record<PluginSubmissionStatus, string> = {
  pending: 'grey',
  ci_passed: 'positive',
  ci_failed: 'negative',
  published: 'primary',
  withdrawn: 'grey',
};

export function statusColor(status: PluginSubmissionStatus): string {
  return STATUS_COLORS[status];
}
