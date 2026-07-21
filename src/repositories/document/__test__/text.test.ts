import { describe, expect, it } from 'bun:test';
import z from 'zod';
import { encodeTextContents, loadTextContents } from '../text';

describe('text repository helpers', () => {
  it('decodes plain text content when no schema is provided', () => {
    const text = 'Hello, world!';
    const encoded = encodeTextContents(text);

    expect(encoded.ok).toBeTrue();
    if (!encoded.ok) return;

    const decoded = loadTextContents(encoded.value);
    expect(decoded.ok).toBeTrue();
    if (!decoded.ok) return;

    expect(decoded.value).toBe(text);
  });

  it('parses and validates JSON content when a schema is provided', () => {
    const payload = { title: 'Document', count: 3 };
    const encoded = encodeTextContents(JSON.stringify(payload));

    expect(encoded.ok).toBeTrue();
    if (!encoded.ok) return;

    const schema = z.object({
      title: z.string(),
      count: z.number(),
    });

    const decoded = loadTextContents(encoded.value, schema);
    expect(decoded.ok).toBeTrue();
    if (!decoded.ok) return;

    expect(decoded.value).toEqual(payload);
  });

  it('returns a failure result when the decoded payload does not match the schema', () => {
    const encoded = encodeTextContents(JSON.stringify({ title: 123 }));

    expect(encoded.ok).toBeTrue();
    if (!encoded.ok) return;

    const schema = z.object({
      title: z.string(),
    });

    const decoded = loadTextContents(encoded.value, schema);
    expect(decoded.ok).toBeFalse();
    if (decoded.ok) return;

    expect(decoded.error.message).toContain('Validation failed');
  });

  it('returns a failure result when the source is not valid base64', () => {
    const decoded = loadTextContents('not valid base64 !!!' as never);
    expect(decoded.ok).toBeFalse();
  });

  it('returns a failure result when JSON parsing fails even though a schema is provided', () => {
    const encoded = encodeTextContents('not-json');
    expect(encoded.ok).toBeTrue();
    if (!encoded.ok) return;

    const decoded = loadTextContents(encoded.value, z.object({ title: z.string() }));
    expect(decoded.ok).toBeFalse();
  });
});
