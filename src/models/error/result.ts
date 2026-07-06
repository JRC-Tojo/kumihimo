// Result 型: 成功と失敗を表現する汎用ユニオン型

export interface Success<T> {
  ok: true;
  value: T;
}

export interface Failure<E = Error> {
  ok: false;
  error: E;
}

export type Result<T, E = Error> = Success<T> | Failure<E>;

// コンストラクタ関数
export function Success(): Success<void>;
export function Success<T>(value: T): Success<T>;
export function Success<T>(value?: T): Success<T | void> {
  if (arguments.length === 0) {
    return { ok: true, value: undefined };
  }
  return { ok: true, value };
}

export function Failure<E = Error>(error: E): Failure<E> {
  return { ok: false, error };
}

export function unwrapOr<T, E = Error>(r: Result<T, E>, fallback: T): T {
  return r.ok ? r.value : fallback;
}

export function unwrapOrThrow<T, E = Error>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  const e = r.error;
  if (e instanceof Error) throw e as unknown as Error;
  throw new Error(String(e));
}

/** unknown の例外値を Error に正規化する。 */
export function toError(e: unknown): Error {
  if (e instanceof Error) return e;
  if (typeof e === 'string') return new Error(e);
  if (e === null || typeof e !== 'object') return new Error(String(e));
  try {
    return new Error(JSON.stringify(e) ?? Object.prototype.toString.call(e));
  } catch {
    return new Error(Object.prototype.toString.call(e));
  }
}
