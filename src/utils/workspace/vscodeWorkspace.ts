import z from 'zod';
import { Failure, Success, toError, type Result } from 'src/models/error/result';

/**
 * VSCodeの`.code-workspace`ファイルの最小スキーマ
 *
 * 本システムで利用するのは`folders`のみ（`settings`等その他のキーは無視する）
 */
export const VscodeWorkspaceFile = z.object({
  folders: z.array(
    z.object({
      path: z.string(),
      name: z.string().optional(),
    }),
  ),
  settings: z.record(z.string(), z.unknown()).optional(),
});
export type VscodeWorkspaceFile = z.infer<typeof VscodeWorkspaceFile>;

/**
 * `.code-workspace`ファイルの文字列内容をパースする
 */
export function parseWorkspaceFile(fileContent: string): Result<VscodeWorkspaceFile> {
  try {
    const parsed = JSON.parse(fileContent);
    const validated = VscodeWorkspaceFile.safeParse(parsed);
    if (!validated.success) return Failure(new Error('Invalid .code-workspace file'));
    return Success(validated.data);
  } catch (e) {
    return Failure(toError(e));
  }
}

/**
 * `folders[].path`が相対パスであるかどうかを判定する
 *
 * 絶対パス（"/"始まり、または"C:\"のようなドライブレター始まり）は
 * File System Access APIのハンドルからは解決できないため区別する
 */
export function isRelativeWorkspacePath(path: string): boolean {
  if (path.startsWith('/')) return false;
  if (/^[a-zA-Z]:[\\/]/.test(path)) return false;
  return true;
}
