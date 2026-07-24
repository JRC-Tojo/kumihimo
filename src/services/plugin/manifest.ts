/**
 * プラグインのメタ情報（`plugin.json`）を検証する
 */
import type { Result } from 'src/models/error/result';
import { Failure, Success } from 'src/models/error/result';
import { PluginSubmissionDraft } from 'src/models/plugin/submission';

/**
 * ストア申請・サイドロードいずれも共通。`id`/`owner`/`deprecated`を持たない
 * 開発者入力（フォーム由来）を検証する
 */
export function parseSubmissionDraft(json: unknown): Result<PluginSubmissionDraft> {
  const parsed = PluginSubmissionDraft.safeParse(json);
  if (!parsed.success) return Failure(parsed.error);
  return Success(parsed.data);
}
