import { describe, expect, it } from 'bun:test';
import { groupAnnotationsByBlendMode } from '../annotationBlendGrouping';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';

/**
 * テスト用に、指定ID・位置・合成モードのみを変えた最小構成のAnnotationStyle（box型）を生成する
 */
function boxStyle(id: AnnotationID, overrides: Partial<AnnotationStyle> = {}): AnnotationStyle {
  return {
    id,
    type: 'box',
    pageNumber: 1,
    x: 0,
    y: 0,
    color: '#000000' as never,
    strokeWidth: 2,
    strokeType: 'solid',
    width: 10,
    height: 10,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    comment: {},
    ...overrides,
  } as AnnotationStyle;
}

const idA = '00000000-0000-4000-8000-000000000001' as AnnotationID;
const idB = '00000000-0000-4000-8000-000000000002' as AnnotationID;
const idC = '00000000-0000-4000-8000-000000000003' as AnnotationID;
const idD = '00000000-0000-4000-8000-000000000004' as AnnotationID;

describe('groupAnnotationsByBlendMode', () => {
  it('すべて normal（未設定含む）の場合は1つのグループにまとめる', () => {
    const annotations = [
      boxStyle(idA, { x: 0, y: 0 }),
      boxStyle(idB, { x: 100, y: 100, blendMode: 'normal' }),
      boxStyle(idC, { x: 200, y: 200 }),
    ];

    const groups = groupAnnotationsByBlendMode(annotations);

    expect(groups.length).toBe(1);
    expect(groups[0]?.annotations.map((a) => a.id)).toEqual([idA, idB, idC]);
  });

  it('normalと非normalが交互の場合、非normalはそれぞれ独立したグループになる', () => {
    const annotations = [
      boxStyle(idA, { x: 0, y: 0 }),
      boxStyle(idB, { x: 100, y: 100, blendMode: 'multiply' }),
      boxStyle(idC, { x: 200, y: 200 }),
    ];

    const groups = groupAnnotationsByBlendMode(annotations);

    expect(groups.length).toBe(3);
    expect(groups[1]?.blendMode).toBe('multiply');
    expect(groups[1]?.annotations.map((a) => a.id)).toEqual([idB]);
  });

  it('同一の非normalブレンドモード同士は、重なっていなければ1つのグループにまとめる', () => {
    const annotations = [
      boxStyle(idA, { x: 0, y: 0, blendMode: 'multiply' }),
      boxStyle(idB, { x: 100, y: 100, blendMode: 'multiply' }),
    ];

    const groups = groupAnnotationsByBlendMode(annotations);

    expect(groups.length).toBe(1);
    expect(groups[0]?.blendMode).toBe('multiply');
    expect(groups[0]?.annotations.map((a) => a.id)).toEqual([idA, idB]);
  });

  it('同一の非normalブレンドモード同士でも、重なっている場合は分割してそれぞれ独立したグループになる', () => {
    const annotations = [
      boxStyle(idA, { x: 0, y: 0, width: 20, height: 20, blendMode: 'multiply' }),
      // idAと重なる位置に配置する
      boxStyle(idB, { x: 5, y: 5, width: 20, height: 20, blendMode: 'multiply' }),
    ];

    const groups = groupAnnotationsByBlendMode(annotations);

    expect(groups.length).toBe(2);
    expect(groups[0]?.annotations.map((a) => a.id)).toEqual([idA]);
    expect(groups[1]?.annotations.map((a) => a.id)).toEqual([idB]);
  });

  it('非normalブレンドモードの値が異なる場合はまとめない', () => {
    const annotations = [
      boxStyle(idA, { x: 0, y: 0, blendMode: 'multiply' }),
      boxStyle(idB, { x: 100, y: 100, blendMode: 'screen' }),
    ];

    const groups = groupAnnotationsByBlendMode(annotations);

    expect(groups.length).toBe(2);
    expect(groups[0]?.blendMode).toBe('multiply');
    expect(groups[1]?.blendMode).toBe('screen');
  });

  it('複数の非normal注釈が重ならず連続していれば、1つのグループにまとめてレイヤー数を削減する', () => {
    const annotations = [
      boxStyle(idA, { x: 0, y: 0, blendMode: 'multiply' }),
      boxStyle(idB, { x: 100, y: 0, blendMode: 'multiply' }),
      boxStyle(idC, { x: 200, y: 0, blendMode: 'multiply' }),
      boxStyle(idD, { x: 300, y: 0, blendMode: 'multiply' }),
    ];

    const groups = groupAnnotationsByBlendMode(annotations);

    // 修正前の実装（常に1注釈1レイヤー）なら4グループになるところ、1グループに削減される
    expect(groups.length).toBe(1);
    expect(groups[0]?.annotations.length).toBe(4);
  });
});
