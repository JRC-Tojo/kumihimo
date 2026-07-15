import { describe, expect, it } from 'bun:test';
import { AnnotationStyle, ArrowAnnotationStyle } from '../pdf';

const baseFields = {
  id: '00000000-0000-4000-8000-000000000000',
  pageNumber: 1,
  x: 0,
  y: 0,
  color: '#000000',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('ArrowAnnotationStyle', () => {
  it('startHead/endHead/headSizeを省略した場合はデフォルト値が補完される', () => {
    const parsed = ArrowAnnotationStyle.parse({
      ...baseFields,
      type: 'arrow',
      points: [0, 0, 10, 10],
    });

    expect(parsed.startHead).toBe('none');
    expect(parsed.endHead).toBe('triangle');
    expect(parsed.headSize).toBe(10);
  });

  it('pointsが4要素でない場合は検証エラーになる', () => {
    const result = ArrowAnnotationStyle.safeParse({
      ...baseFields,
      type: 'arrow',
      points: [0, 0, 10],
    });

    expect(result.success).toBeFalse();
  });

  it('AnnotationStyleのdiscriminatedUnionにarrowが含まれる', () => {
    const result = AnnotationStyle.safeParse({
      ...baseFields,
      type: 'arrow',
      points: [0, 0, 10, 10],
      startHead: 'open',
      endHead: 'none',
    });

    expect(result.success).toBeTrue();
  });
});
