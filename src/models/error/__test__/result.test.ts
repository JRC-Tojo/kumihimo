import { describe, expect, it } from 'bun:test';
import { Success, Failure, unwrapOr, unwrapOrThrow, NotFoundError, toError } from '../result';

describe('Success/Failure', () => {
  it('引数なしのSuccessはvalue: undefinedを返す', () => {
    expect(Success()).toEqual({ ok: true, value: undefined });
  });

  it('引数ありのSuccessはvalueを保持する', () => {
    expect(Success(42)).toEqual({ ok: true, value: 42 });
  });

  it('Failureはerrorを保持する', () => {
    const error = new Error('boom');
    expect(Failure(error)).toEqual({ ok: false, error });
  });
});

describe('unwrapOr', () => {
  it('成功時はvalueを返す', () => {
    expect(unwrapOr(Success(1), 0)).toBe(1);
  });

  it('失敗時はfallbackを返す', () => {
    expect(unwrapOr(Failure(new Error('x')), 0)).toBe(0);
  });
});

describe('unwrapOrThrow', () => {
  it('成功時はvalueを返す', () => {
    expect(unwrapOrThrow(Success('ok'))).toBe('ok');
  });

  it('失敗時、errorがErrorインスタンスならそのままthrowする', () => {
    const error = new Error('boom');
    expect(() => unwrapOrThrow(Failure(error))).toThrow(error);
  });

  it('失敗時、errorがError以外なら文字列化してthrowする', () => {
    expect(() => unwrapOrThrow(Failure('plain-string-error'))).toThrow('plain-string-error');
  });
});

describe('NotFoundError', () => {
  it('nameがNotFoundErrorになる', () => {
    const error = new NotFoundError('見つかりません');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('NotFoundError');
    expect(error.message).toBe('見つかりません');
  });
});

describe('toError', () => {
  it('Errorインスタンスはそのまま返す', () => {
    const error = new Error('boom');
    expect(toError(error)).toBe(error);
  });

  it('文字列はErrorに変換する', () => {
    expect(toError('boom')).toBeInstanceOf(Error);
    expect(toError('boom').message).toBe('boom');
  });

  it('オブジェクトはJSON文字列化してErrorに変換する', () => {
    const err = toError({ code: 'E1' });
    expect(err.message).toBe(JSON.stringify({ code: 'E1' }));
  });

  it('循環参照オブジェクトはtoStringにフォールバックする', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const err = toError(circular);
    expect(err.message).toBe(Object.prototype.toString.call(circular));
  });

  it('数値等のプリミティブはString化してErrorに変換する', () => {
    expect(toError(42).message).toBe('42');
  });
});
