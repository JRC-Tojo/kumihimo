/**
 * アプリ起動前ロック画面のパスワード検証
 */
import { Success, Failure, toError, type Result } from 'src/models/error/result';
import { LOCK_PASSWORD_HASH } from 'src/models/lock';
import { saveSettings } from 'src/settings/main';

/**
 * 文字列をSHA-256でハッシュ化し、16進文字列で返す
 */
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 入力されたパスワードを検証し、一致すれば解除済みフラグを保存する
 *
 * 一致・不一致はいずれも正常系（`Result`のok/ngではなくtrue/falseで表現する）とし、
 * `Failure`はハッシュ化処理自体が失敗した場合のみに用いる
 */
export async function verifyLockPassword(input: string): Promise<Result<boolean>> {
  try {
    const hash = await sha256Hex(input);
    const matched = hash === LOCK_PASSWORD_HASH;
    if (!matched) return Success(false);

    const saveRes = await saveSettings('unlocked', true);
    if (!saveRes.ok) return saveRes;
    return Success(true);
  } catch (e) {
    return Failure(toError(e));
  }
}
