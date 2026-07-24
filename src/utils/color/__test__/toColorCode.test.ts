import { describe, expect, it } from 'bun:test';
import { toColorCode } from '../toColorCode';

describe('toColorCode', () => {
  it('undefinedを渡すとundefinedを返す', () => {
    expect(toColorCode(undefined)).toBeUndefined();
  });

  it('6桁の16進カラーコードはそのままColorCodeとして返る', () => {
    expect(toColorCode('#ff00aa')).toBe('#ff00aa' as never);
  });

  it('3桁の16進カラーコードもColorCodeとして返る', () => {
    expect(toColorCode('#f0a')).toBe('#f0a' as never);
  });

  it('不正な文字列（#無し・桁数不正等）はundefinedを返す', () => {
    expect(toColorCode('ff00aa')).toBeUndefined();
    expect(toColorCode('#ff00a')).toBeUndefined();
    expect(toColorCode('not-a-color')).toBeUndefined();
    expect(toColorCode('')).toBeUndefined();
  });
});
