import { describe, test, expect } from 'bun:test';
import { getAnnotationSortKey, computeReorderedZIndex } from '../annotationOrder';
import type { AnnotationID, BoxAnnotationStyle } from 'src/models/document/pdf';

function makeBox(id: string, createdAt: string, zIndex?: number): BoxAnnotationStyle {
  return {
    type: 'box',
    id: id as AnnotationID,
    pageNumber: 1,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    color: '#000000' as BoxAnnotationStyle['color'],
    strokeWidth: 2,
    strokeType: 'solid',
    createdAt,
    updatedAt: createdAt,
    comment: {},
    zIndex,
  };
}

describe('getAnnotationSortKey', () => {
  test('zIndexが設定されている場合はそれを使う', () => {
    const a = makeBox('a', '2024-01-01T00:00:00.000Z', 42);
    expect(getAnnotationSortKey(a)).toBe(42);
  });

  test('zIndex未設定の場合はcreatedAtのUnixMsを使う', () => {
    const a = makeBox('a', '2024-01-01T00:00:00.000Z');
    expect(getAnnotationSortKey(a)).toBe(new Date('2024-01-01T00:00:00.000Z').getTime());
  });
});

describe('computeReorderedZIndex', () => {
  test('対象が見つからない場合はnullを返す', () => {
    const list = [makeBox('a', '2024-01-01T00:00:00.000Z')];
    expect(computeReorderedZIndex(list, 'missing' as AnnotationID, 'front')).toBeNull();
  });

  test('front: 既存最大値より大きい値を返す', () => {
    const list = [
      makeBox('a', '2024-01-01T00:00:00.000Z'),
      makeBox('b', '2024-01-02T00:00:00.000Z'),
      makeBox('c', '2024-01-03T00:00:00.000Z'),
    ];
    const result = computeReorderedZIndex(list, 'a' as AnnotationID, 'front');
    const maxKey = Math.max(...list.map(getAnnotationSortKey));
    expect(result).toBeGreaterThan(maxKey);
  });

  test('back: 既存最小値より小さい値を返す', () => {
    const list = [
      makeBox('a', '2024-01-01T00:00:00.000Z'),
      makeBox('b', '2024-01-02T00:00:00.000Z'),
      makeBox('c', '2024-01-03T00:00:00.000Z'),
    ];
    const result = computeReorderedZIndex(list, 'c' as AnnotationID, 'back');
    const minKey = Math.min(...list.map(getAnnotationSortKey));
    expect(result).toBeLessThan(minKey);
  });

  test('forward: 1つ前面の要素と入れ替わる位置になる', () => {
    const list = [
      makeBox('a', '2024-01-01T00:00:00.000Z'),
      makeBox('b', '2024-01-02T00:00:00.000Z'),
      makeBox('c', '2024-01-03T00:00:00.000Z'),
    ];
    const result = computeReorderedZIndex(list, 'a' as AnnotationID, 'forward')!;
    const bKey = getAnnotationSortKey(list[1]!);
    const cKey = getAnnotationSortKey(list[2]!);
    expect(result).toBeGreaterThan(bKey);
    expect(result).toBeLessThan(cKey);
  });

  test('backward: 1つ背面の要素と入れ替わる位置になる', () => {
    const list = [
      makeBox('a', '2024-01-01T00:00:00.000Z'),
      makeBox('b', '2024-01-02T00:00:00.000Z'),
      makeBox('c', '2024-01-03T00:00:00.000Z'),
    ];
    const result = computeReorderedZIndex(list, 'c' as AnnotationID, 'backward')!;
    const aKey = getAnnotationSortKey(list[0]!);
    const bKey = getAnnotationSortKey(list[1]!);
    expect(result).toBeGreaterThan(aKey);
    expect(result).toBeLessThan(bKey);
  });

  test('forward: すでに最前面の場合は現状維持', () => {
    const list = [
      makeBox('a', '2024-01-01T00:00:00.000Z'),
      makeBox('b', '2024-01-02T00:00:00.000Z'),
    ];
    const result = computeReorderedZIndex(list, 'b' as AnnotationID, 'forward');
    expect(result).toBe(getAnnotationSortKey(list[1]!));
  });

  test('backward: すでに最背面の場合は現状維持', () => {
    const list = [
      makeBox('a', '2024-01-01T00:00:00.000Z'),
      makeBox('b', '2024-01-02T00:00:00.000Z'),
    ];
    const result = computeReorderedZIndex(list, 'a' as AnnotationID, 'backward');
    expect(result).toBe(getAnnotationSortKey(list[0]!));
  });

  test('単一要素の場合、forward/backwardは現状維持', () => {
    const list = [makeBox('a', '2024-01-01T00:00:00.000Z')];
    expect(computeReorderedZIndex(list, 'a' as AnnotationID, 'forward')).toBe(
      getAnnotationSortKey(list[0]!),
    );
    expect(computeReorderedZIndex(list, 'a' as AnnotationID, 'backward')).toBe(
      getAnnotationSortKey(list[0]!),
    );
  });
});
