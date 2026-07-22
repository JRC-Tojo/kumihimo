/**
 * プラグインのメタ情報（`plugin.json`）を検証する
 */
import type { Result } from 'src/models/error/result';
import { Failure, Success } from 'src/models/error/result';
import { PluginManifest } from 'src/models/plugin/manifest';

export function parseManifest(json: unknown): Result<PluginManifest> {
  const parsed = PluginManifest.safeParse(json);
  if (!parsed.success) return Failure(parsed.error);
  return Success(parsed.data);
}
