import { describe, it, expect } from 'bun:test';
import {
  base64ToUint8Array,
  calcBase64Hash,
  getBase64FileSize,
  uint8ArrayToBase64,
} from '../base64';

describe('base64 utils', () => {
  it('roundtrips a UTF-8 string via TextEncoder/TextDecoder', () => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const text = 'Hello, Bun! こんにちは';
    const bytes = encoder.encode(text);
    const b64 = uint8ArrayToBase64(bytes);
    expect(b64.ok).toBeTrue();
    if (!b64.ok) return;
    const out = base64ToUint8Array(b64.value);
    expect(out.ok).toBeTrue();
    if (!out.ok) return;
    expect(new Uint8Array(out.value)).toEqual(bytes);
    expect(decoder.decode(out.value)).toBe(text);
  });

  it('accepts data URI prefixes', () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode('hi');
    const b64 = uint8ArrayToBase64(bytes);
    expect(b64.ok).toBeTrue();
    if (!b64.ok) return;
    const dataUri = `data:application/octet-stream;base64,${b64.value}`;
    const out = base64ToUint8Array(dataUri);
    expect(out.ok).toBeTrue();
    if (!out.ok) return;
    expect(out.value).toEqual(bytes);
  });

  it("matches known base64 for 'hello'", () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode('hello');
    const b64 = uint8ArrayToBase64(bytes);
    expect(b64.ok).toBeTrue();
    if (!b64.ok) return;
    expect(b64.value).toBe('aGVsbG8=');
    const out = base64ToUint8Array('aGVsbG8=');
    expect(out.ok).toBeTrue();
    if (!out.ok) return;
    expect(out.value).toEqual(bytes);
  });

  it('calculates file size from raw and data URI base64 content', () => {
    const fromOnlyData = getBase64FileSize('aGVsbG8=');
    expect(fromOnlyData.ok).toBeTrue();
    if (!fromOnlyData.ok) return;
    expect(fromOnlyData.value).toBe(5);

    const fromUri = getBase64FileSize('data:text/plain;base64,aGVsbG8=');
    expect(fromUri.ok).toBeTrue();
    if (!fromUri.ok) return;
    expect(fromUri.value).toBe(5);
  });

  it('calcurate hash value from any data', async () => {
    const targetBase64 = 'aGVsbG8='; // hello
    const hashed = await calcBase64Hash(targetBase64, 'SHA-256');
    expect(hashed.ok).toBeTrue();
    if (!hashed.ok) return;
    expect(hashed.value).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });
});
