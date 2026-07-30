import { describe, expect, it } from 'bun:test';
import { shouldKeepSelectionMode } from 'src/utils/document/annotationToolClickMode';
import type { AnnotationStyle } from 'src/models/document/pdf';

/** 指定した種別だけを持つテスト用アノテーションを作成する */
function makeAnnotation(type: AnnotationStyle['type']): AnnotationStyle {
  return { type } as AnnotationStyle;
}

describe('shouldKeepSelectionMode', () => {
  it('選択中アノテーションが1件・型が一致する場合はtrueを返す', () => {
    expect(shouldKeepSelectionMode([makeAnnotation('box')], 'box')).toBe(true);
  });

  it('選択中アノテーションが1件でも型が異なる場合はfalseを返す', () => {
    expect(shouldKeepSelectionMode([makeAnnotation('box')], 'circle')).toBe(false);
  });

  it('選択が0件の場合はfalseを返す', () => {
    expect(shouldKeepSelectionMode([], 'box')).toBe(false);
  });

  it('選択がundefinedの場合はfalseを返す', () => {
    expect(shouldKeepSelectionMode(undefined, 'box')).toBe(false);
  });

  it('選択が複数件の場合は型が一致してもfalseを返す', () => {
    expect(shouldKeepSelectionMode([makeAnnotation('box'), makeAnnotation('box')], 'box')).toBe(
      false,
    );
  });
});
