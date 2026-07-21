import { describe, expect, it } from 'bun:test';
import {
  AnnotationStyle,
  ArrowAnnotationStyle,
  PolygonAnnotationStyle,
  PolylineAnnotationStyle,
  TextAnnotationStyle,
} from '../pdf';

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

describe('PolylineAnnotationStyle', () => {
  it('startHead/endHead/headSizeを省略した場合はデフォルト値が補完される（折れ線は矢じり無し）', () => {
    const parsed = PolylineAnnotationStyle.parse({
      ...baseFields,
      type: 'polyline',
      points: [0, 0, 10, 10, 20, 0],
    });

    expect(parsed.startHead).toBe('none');
    expect(parsed.endHead).toBe('none');
    expect(parsed.headSize).toBe(10);
  });

  it('pointsが4未満（2頂点未満）の場合は検証エラーになる', () => {
    const result = PolylineAnnotationStyle.safeParse({
      ...baseFields,
      type: 'polyline',
      points: [0, 0],
    });

    expect(result.success).toBeFalse();
  });

  it('pointsの要素数が奇数（x/yが対になっていない）場合は検証エラーになる', () => {
    const result = PolylineAnnotationStyle.safeParse({
      ...baseFields,
      type: 'polyline',
      points: [0, 0, 10, 10, 20],
    });

    expect(result.success).toBeFalse();
  });
});

describe('PolygonAnnotationStyle', () => {
  it('3頂点以上（points.length >= 6）を要求する', () => {
    const tooFew = PolygonAnnotationStyle.safeParse({
      ...baseFields,
      type: 'polygon',
      points: [0, 0, 10, 0],
    });
    expect(tooFew.success).toBeFalse();

    const ok = PolygonAnnotationStyle.safeParse({
      ...baseFields,
      type: 'polygon',
      points: [0, 0, 10, 0, 5, 10],
    });
    expect(ok.success).toBeTrue();
  });

  it('pointsの要素数が奇数（x/yが対になっていない）場合は検証エラーになる', () => {
    const result = PolygonAnnotationStyle.safeParse({
      ...baseFields,
      type: 'polygon',
      points: [0, 0, 10, 0, 5],
    });

    expect(result.success).toBeFalse();
  });
});

describe('TextAnnotationStyle', () => {
  it('省略可能なフィールドにデフォルト値が補完される', () => {
    const parsed = TextAnnotationStyle.parse({
      ...baseFields,
      type: 'text',
      width: 100,
      height: 50,
      textColor: '#000000',
    });

    expect(parsed.text).toBe('');
    expect(parsed.fontFamily).toBe('sans-serif');
    expect(parsed.fontSize).toBe(16);
    expect(parsed.fontWeight).toBe(400);
    expect(parsed.textAlign).toBe('left');
    expect(parsed.fillColor).toBeUndefined();
  });

  it('fillColorが不正な形式の場合は検証エラーになる', () => {
    const result = TextAnnotationStyle.safeParse({
      ...baseFields,
      type: 'text',
      width: 100,
      height: 50,
      textColor: '#000000',
      fillColor: 'not-a-color',
    });

    expect(result.success).toBeFalse();
  });
});
