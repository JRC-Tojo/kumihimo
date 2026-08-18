import { describe, expect, it, mock } from 'bun:test';
import { Success } from 'src/models/error/result';

// SHA-256('test-password')の16進文字列
const TEST_PASSWORD_HASH = 'c638833f69bbfb3c267afa0a74434812436b8f08a81fd263c6be6871de4f1265';

const savedSettings: { unlocked: boolean | undefined } = { unlocked: undefined };

/**
 * `verifyLockPassword`呼び出しによる`mock.module`経由の代入をTypeScriptのnarrowingが
 * 追いきれず、代入前の型（undefined）のまま固定されてしまうため、明示的な型注釈で
 * 本来の型（boolean | undefined）に戻してから参照する
 */
function currentSavedUnlocked(): boolean | undefined {
  return savedSettings.unlocked;
}

void mock.module('src/models/lock', () => ({
  LOCK_PASSWORD_HASH: TEST_PASSWORD_HASH,
}));

void mock.module('src/settings/main', () => ({
  saveSettings: (key: string, value: boolean) => {
    if (key === 'unlocked') savedSettings.unlocked = value;
    return Promise.resolve(Success(undefined));
  },
}));

const { verifyLockPassword } = await import('../lock');

describe('verifyLockPassword', () => {
  it('正しいパスワードの場合はtrueを返し、解除済みフラグを保存する', async () => {
    savedSettings.unlocked = undefined;
    const res = await verifyLockPassword('test-password');
    expect(res.ok).toBe(true);
    expect(res.ok && res.value).toBe(true);
    expect(currentSavedUnlocked()).toBe(true);
  });

  it('誤ったパスワードの場合はfalseを返し、解除済みフラグは保存しない', async () => {
    savedSettings.unlocked = undefined;
    const res = await verifyLockPassword('wrong-password');
    expect(res.ok).toBe(true);
    expect(res.ok && res.value).toBe(false);
    expect(currentSavedUnlocked()).toBeUndefined();
  });
});
