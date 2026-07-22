/**
 * GitHub個人アクセストークン（PAT）の検証
 */
import type { Result } from 'src/models/error/result';
import { Success } from 'src/models/error/result';
import { getAuthenticatedUser } from 'src/repositories/plugin/githubApi';

/**
 * トークンが有効かを確認し、紐づくGitHubユーザー名を返す
 */
export async function verifyGithubToken(token: string): Promise<Result<string>> {
  const res = await getAuthenticatedUser(token);
  if (!res.ok) return res;
  return Success(res.value.login);
}
