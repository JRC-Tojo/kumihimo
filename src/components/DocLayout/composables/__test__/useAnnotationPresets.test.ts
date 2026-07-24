import { describe, expect, it } from 'bun:test';
import {
  annotationStyleToPresetStyle,
  buildPresetApplyPatch,
  reorderPresetsOfType,
} from '../useAnnotationPresets';
import type { AnnotationTool, DrawingAnnotationStyle } from 'src/models/docPage';
import type { AnnotationStyle } from 'src/models/document/pdf';

function makeTool(id: string, type: AnnotationTool['style']['type']): AnnotationTool {
  return {
    id,
    name: id,
    style: { type, strokeColor: '#000000', strokeWidth: 1, strokeType: 'solid', strokeOpacity: 1 },
  } as AnnotationTool;
}

describe('reorderPresetsOfType', () => {
  it('対象種別だけを並び替え、他種別の位置は変えない', () => {
    const all = [
      makeTool('box-1', 'box'),
      makeTool('line-1', 'line'),
      makeTool('box-2', 'box'),
      makeTool('line-2', 'line'),
      makeTool('box-3', 'box'),
    ];

    const reordered = reorderPresetsOfType(all, 'box', [
      makeTool('box-3', 'box'),
      makeTool('box-1', 'box'),
      makeTool('box-2', 'box'),
    ]);

    expect(reordered.map((t) => t.id)).toEqual(['box-3', 'line-1', 'box-1', 'line-2', 'box-2']);
  });

  it('対象種別が1件も無い場合はそのまま返す', () => {
    const all = [makeTool('line-1', 'line')];
    const reordered = reorderPresetsOfType(all, 'box', []);
    expect(reordered).toEqual(all);
  });
});

const boxDrawingStyle: DrawingAnnotationStyle = {
  type: 'box',
  strokeColor: '#111111',
  strokeWidth: 2,
  strokeType: 'solid',
  strokeOpacity: 1,
  fillColor: '#222222',
  fillPattern: 'solid',
  fillOpacity: 0.5,
};

const lineDrawingStyle: DrawingAnnotationStyle = {
  type: 'line',
  strokeColor: '#111111',
  strokeWidth: 2,
  strokeType: 'solid',
  strokeOpacity: 1,
};

const arrowDrawingStyle: DrawingAnnotationStyle = {
  type: 'arrow',
  strokeColor: '#111111',
  strokeWidth: 2,
  strokeType: 'solid',
  strokeOpacity: 1,
  startHead: 'none',
  endHead: 'triangle',
  headSize: 12,
};

const textDrawingStyle: DrawingAnnotationStyle = {
  type: 'text',
  textColor: '#333333',
  fontWeight: 400,
  fontFamily: 'sans-serif',
  fontSize: 16,
  textAlign: 'left',
  strokeColor: '#111111',
  strokeWidth: 0,
  strokeType: 'solid',
  strokeOpacity: 1,
  fillColor: '#222222',
  fillPattern: 'solid',
  fillOpacity: 0.5,
};

describe('buildPresetApplyPatch', () => {
  it('アノテーションの種別がpresetと異なる場合はnullを返す', () => {
    const patchFn = buildPresetApplyPatch(boxDrawingStyle);
    const circleAnnot = { type: 'circle' } as unknown as AnnotationStyle;
    expect(patchFn(circleAnnot)).toBeNull();
  });

  it('box種別: color/fillColor等を含むpatchを返す', () => {
    const patchFn = buildPresetApplyPatch(boxDrawingStyle);
    const boxAnnot = { type: 'box' } as unknown as AnnotationStyle;
    const patch = patchFn(boxAnnot);

    expect(patch).toEqual({
      color: '#111111' as never,
      strokeWidth: 2,
      strokeType: 'solid',
      strokeOpacity: 1,
      blendMode: undefined,
      fillColor: '#222222' as never,
      fillOpacity: 0.5,
    });
  });

  it('line種別: 共通スタイルのみを返す（fillColor等は含まない）', () => {
    const patchFn = buildPresetApplyPatch(lineDrawingStyle);
    const lineAnnot = { type: 'line' } as unknown as AnnotationStyle;
    const patch = patchFn(lineAnnot);

    expect(patch).toEqual({
      color: '#111111' as never,
      strokeWidth: 2,
      strokeType: 'solid',
      strokeOpacity: 1,
      blendMode: undefined,
    });
  });

  it('arrow種別: startHead/endHead/headSizeを含むpatchを返す', () => {
    const patchFn = buildPresetApplyPatch(arrowDrawingStyle);
    const arrowAnnot = { type: 'arrow' } as unknown as AnnotationStyle;
    const patch = patchFn(arrowAnnot);

    expect(patch).toMatchObject({
      startHead: 'none',
      endHead: 'triangle',
      headSize: 12,
    });
  });

  it('text種別: textColor等を含むpatchを返す', () => {
    const patchFn = buildPresetApplyPatch(textDrawingStyle);
    const textAnnot = { type: 'text' } as unknown as AnnotationStyle;
    const patch = patchFn(textAnnot);

    expect(patch).toMatchObject({
      textColor: '#333333',
      fontFamily: 'sans-serif',
      fontSize: 16,
      fontWeight: 400,
      fillColor: '#222222',
      fillOpacity: 0.5,
    });
  });

  it('text種別でtextColorが不正な場合はnullを返す', () => {
    const invalidTextStyle: DrawingAnnotationStyle = { ...textDrawingStyle, textColor: 'invalid' };
    const patchFn = buildPresetApplyPatch(invalidTextStyle);
    const textAnnot = { type: 'text' } as unknown as AnnotationStyle;
    expect(patchFn(textAnnot)).toBeNull();
  });

  it('strokeColorが不正な場合はnullを返す（switch分岐に入る前にreturnする）', () => {
    const invalidBoxStyle: DrawingAnnotationStyle = { ...boxDrawingStyle, strokeColor: 'invalid' };
    const patchFn = buildPresetApplyPatch(invalidBoxStyle);
    const boxAnnot = { type: 'box' } as unknown as AnnotationStyle;
    expect(patchFn(boxAnnot)).toBeNull();
  });
});

describe('annotationStyleToPresetStyle', () => {
  it('box種別: fillColor未設定時はcolorをfillColorとして流用し、fillPatternは"none"になる', () => {
    const boxAnnot = {
      type: 'box',
      color: '#111111',
      strokeWidth: 2,
      strokeType: 'solid',
      strokeOpacity: 1,
    } as unknown as AnnotationStyle;

    const preset = annotationStyleToPresetStyle(boxAnnot);

    expect(preset).toMatchObject({
      type: 'box',
      strokeColor: '#111111',
      fillColor: '#111111',
      fillPattern: 'none',
      fillOpacity: 1,
    });
  });

  it('box種別: fillColor設定済みの場合はfillPatternが"solid"になる', () => {
    const boxAnnot = {
      type: 'box',
      color: '#111111',
      fillColor: '#222222',
      fillOpacity: 0.3,
      strokeWidth: 2,
      strokeType: 'solid',
      strokeOpacity: 1,
    } as unknown as AnnotationStyle;

    const preset = annotationStyleToPresetStyle(boxAnnot);

    expect(preset).toMatchObject({
      fillColor: '#222222',
      fillPattern: 'solid',
      fillOpacity: 0.3,
    });
  });

  it('arrow種別: headSize未設定時は10にフォールバックする', () => {
    const arrowAnnot = {
      type: 'arrow',
      color: '#111111',
      strokeWidth: 2,
      strokeType: 'solid',
      strokeOpacity: 1,
      startHead: 'none',
      endHead: 'triangle',
    } as unknown as AnnotationStyle;

    const preset = annotationStyleToPresetStyle(arrowAnnot);

    expect(preset).toMatchObject({
      type: 'arrow',
      startHead: 'none',
      endHead: 'triangle',
      headSize: 10,
    });
  });

  it('text種別: 位置・サイズ以外のスタイル情報のみを抽出する', () => {
    const textAnnot = {
      type: 'text',
      color: '#111111',
      strokeWidth: 0,
      strokeType: 'solid',
      textColor: '#333333',
      fontWeight: 400,
      fontFamily: 'sans-serif',
      fontSize: 16,
      textAlign: 'left',
    } as unknown as AnnotationStyle;

    const preset = annotationStyleToPresetStyle(textAnnot);

    expect(preset).toMatchObject({
      type: 'text',
      textColor: '#333333',
      fontFamily: 'sans-serif',
      fontSize: 16,
      fillColor: '#111111',
      fillPattern: 'none',
    });
  });

  it('line種別: 共通スタイルのみを返す', () => {
    const lineAnnot = {
      type: 'line',
      color: '#111111',
      strokeWidth: 2,
      strokeType: 'dashed',
      strokeOpacity: 1,
    } as unknown as AnnotationStyle;

    const preset = annotationStyleToPresetStyle(lineAnnot);

    expect(preset).toEqual({
      type: 'line',
      strokeColor: '#111111',
      strokeWidth: 2,
      strokeType: 'dashed',
      strokeOpacity: 1,
      blendMode: 'normal',
    });
  });

  it('strokeWidth/strokeType/strokeOpacity/blendMode未設定時はデフォルト値にフォールバックする', () => {
    const lineAnnot = { type: 'line', color: '#111111' } as unknown as AnnotationStyle;

    const preset = annotationStyleToPresetStyle(lineAnnot);

    expect(preset).toEqual({
      type: 'line',
      strokeColor: '#111111',
      strokeWidth: 2,
      strokeType: 'solid',
      strokeOpacity: 1,
      blendMode: 'normal',
    });
  });
});
