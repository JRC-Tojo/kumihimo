import { describe, expect, it } from 'bun:test';
import {
  AnnotationID,
  ColorCode,
  type BoxAnnotationStyle,
  type LineAnnotationStyle,
} from 'src/models/document/pdf';
import { DEFAULT_RELATIONAL_VERIFICATION_STYLE } from 'src/models/relational/style';
import { applyRelationalOverrideToStyle } from '../relationalStyleOverride';

const TEST_ID = AnnotationID.parse('11111111-1111-4111-8111-111111111111');

function buildBox(): BoxAnnotationStyle {
  return {
    id: TEST_ID,
    pageNumber: 1,
    x: 10,
    y: 10,
    color: ColorCode.parse('#0000ff'),
    strokeWidth: 3,
    strokeType: 'solid',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    comment: {},
    type: 'box',
    width: 50,
    height: 30,
    fillColor: ColorCode.parse('#00ff00'),
    fillOpacity: 0.9,
  };
}

function buildLine(): LineAnnotationStyle {
  return {
    id: TEST_ID,
    pageNumber: 1,
    x: 10,
    y: 10,
    color: ColorCode.parse('#0000ff'),
    strokeWidth: 3,
    strokeType: 'solid',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    comment: {},
    type: 'line',
    points: [0, 0, 10, 10],
  };
}

describe('applyRelationalOverrideToStyle', () => {
  it('statusがpending/undefinedの場合は元のannotationをそのまま返す', () => {
    const box = buildBox();
    expect(applyRelationalOverrideToStyle(box, 'pending', DEFAULT_RELATIONAL_VERIFICATION_STYLE)).toBe(
      box,
    );
    expect(
      applyRelationalOverrideToStyle(box, undefined, DEFAULT_RELATIONAL_VERIFICATION_STYLE),
    ).toBe(box);
  });

  it('statusがokの場合、fillColorを持つ型はcolor/strokeWidth/fillColor/fillOpacityがすべて検証スタイルの値に置き換わる', () => {
    const box = buildBox();
    const result = applyRelationalOverrideToStyle(box, 'ok', DEFAULT_RELATIONAL_VERIFICATION_STYLE);
    const okStyle = DEFAULT_RELATIONAL_VERIFICATION_STYLE.ok;

    expect(result.color as string | undefined).toBe(okStyle.strokeColor);
    expect(result.strokeWidth).toBe(okStyle.strokeWidth);
    if (result.type !== 'box') throw new Error('expected box');
    expect(result.fillColor as string | undefined).toBe(okStyle.fillColor);
    expect(result.fillOpacity).toBe(okStyle.fillOpacity);
    // 元の座標・サイズ等は変更されない
    expect(result.x).toBe(box.x);
    expect(result.width).toBe(box.width);
  });

  it('statusがngの場合、fillColorを持たない型（line）はcolor/strokeWidthのみ上書きされる', () => {
    const line = buildLine();
    const result = applyRelationalOverrideToStyle(line, 'ng', DEFAULT_RELATIONAL_VERIFICATION_STYLE);
    const ngStyle = DEFAULT_RELATIONAL_VERIFICATION_STYLE.ng;

    expect(result.color as string | undefined).toBe(ngStyle.strokeColor);
    expect(result.strokeWidth).toBe(ngStyle.strokeWidth);
    expect('fillColor' in result).toBeFalse();
  });

  it('元のannotationに元々fillColorが未設定でも、statusがok/ngなら型が対応していればfillColorが付与される', () => {
    const box = buildBox();
    const noFillBox = { ...box, fillColor: undefined, fillOpacity: undefined };
    const result = applyRelationalOverrideToStyle(
      noFillBox,
      'ok',
      DEFAULT_RELATIONAL_VERIFICATION_STYLE,
    );
    if (result.type !== 'box') throw new Error('expected box');
    expect(result.fillColor as string | undefined).toBe(DEFAULT_RELATIONAL_VERIFICATION_STYLE.ok.fillColor);
  });
});
