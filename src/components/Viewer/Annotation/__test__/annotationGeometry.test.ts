import { describe, expect, it } from 'bun:test';
import { ANNOTATION_GEOMETRY, type AnnotationGeometryModule } from '../annotationGeometry';
import type { DrawingAnnotationStyle } from 'src/models/docPage';
import type { AnnotationStyle } from 'src/models/document/pdf';
import { hexToRgba } from 'src/utils/color/hexToRgba';

/** drawMode: 'clickPoints' であることを型で確定させるためのテスト用ヘルパー */
function asClickPointsModule<T extends AnnotationStyle>(module: AnnotationGeometryModule<T>) {
  if (module.drawMode !== 'clickPoints')
    throw new Error('expected a clickPoints-mode geometry module');
  return module;
}

const boxStyle: DrawingAnnotationStyle = {
  type: 'box',
  strokeColor: '#0000ff',
  strokeWidth: 5,
  strokeType: 'solid',
  strokeOpacity: 1,
  fillColor: '#0000ff',
  fillPattern: 'solid',
  fillOpacity: 0.5,
  blendMode: 'normal',
};

const lineStyle: DrawingAnnotationStyle = {
  type: 'line',
  strokeColor: '#000000',
  strokeWidth: 2,
  strokeType: 'solid',
  strokeOpacity: 1,
  blendMode: 'normal',
};

const circleStyle: DrawingAnnotationStyle = {
  type: 'circle',
  strokeColor: '#009900',
  strokeWidth: 3,
  strokeType: 'solid',
  strokeOpacity: 1,
  fillColor: '#009900',
  fillPattern: 'solid',
  fillOpacity: 0.3,
  blendMode: 'normal',
};

const arrowStyle: DrawingAnnotationStyle = {
  type: 'arrow',
  strokeColor: '#000000',
  strokeWidth: 3,
  strokeType: 'solid',
  strokeOpacity: 1,
  startHead: 'none',
  endHead: 'triangle',
  headSize: 12,
  blendMode: 'normal',
};

const polylineStyle: DrawingAnnotationStyle = {
  type: 'polyline',
  strokeColor: '#000000',
  strokeWidth: 3,
  strokeType: 'solid',
  strokeOpacity: 1,
  startHead: 'none',
  endHead: 'triangle',
  headSize: 12,
  blendMode: 'normal',
};

const polygonStyle: DrawingAnnotationStyle = {
  type: 'polygon',
  strokeColor: '#9900cc',
  strokeWidth: 3,
  strokeType: 'solid',
  strokeOpacity: 1,
  fillColor: '#9900cc',
  fillPattern: 'solid',
  fillOpacity: 0.3,
  blendMode: 'normal',
};

const textStyle: DrawingAnnotationStyle = {
  type: 'text',
  strokeColor: '#000000',
  strokeWidth: 0,
  strokeType: 'solid',
  strokeOpacity: 1,
  fillPattern: 'none',
  fillOpacity: 1,
  textColor: '#000000',
  fontWeight: 400,
  fontFamily: 'sans-serif',
  fontSize: 16,
  textAlign: 'left',
  blendMode: 'normal',
};

describe('ANNOTATION_GEOMETRY', () => {
  it('box: createFromPointsは2頂点からwidth/heightを計算する', () => {
    const created = asClickPointsModule(ANNOTATION_GEOMETRY.box).createFromPoints(
      1,
      [
        { x: 10, y: 20 },
        { x: 30, y: 50 },
      ],
      boxStyle,
    );
    expect(created).not.toBeNull();
    if (!created || created.type !== 'box') throw new Error('unexpected type');
    expect(created.x).toBe(10);
    expect(created.y).toBe(20);
    expect(created.width).toBe(20);
    expect(created.height).toBe(30);
    expect(created.strokeType).toBe('solid');
    expect(created.strokeOpacity).toBe(1);
    expect(created.fillOpacity).toBe(0.5);
    expect(String(created.fillColor)).toBe('#0000ff');
  });

  it('line: createFromPointsは始点を起点としたpointsを生成する', () => {
    const created = asClickPointsModule(ANNOTATION_GEOMETRY.line).createFromPoints(
      1,
      [
        { x: 5, y: 5 },
        { x: 15, y: 25 },
      ],
      lineStyle,
    );
    expect(created).not.toBeNull();
    if (!created || created.type !== 'line') throw new Error('unexpected type');
    expect(created.x).toBe(5);
    expect(created.y).toBe(5);
    expect(created.points).toEqual([0, 0, 10, 20]);
    expect(created.strokeType).toBe('solid');
    expect(created.strokeOpacity).toBe(1);
  });

  it('circle: createFromPointsは2頂点の中点と半径を計算する', () => {
    const created = asClickPointsModule(ANNOTATION_GEOMETRY.circle).createFromPoints(
      1,
      [
        { x: 0, y: 0 },
        { x: 6, y: 8 },
      ],
      circleStyle,
    );
    expect(created).not.toBeNull();
    if (!created || created.type !== 'circle') throw new Error('unexpected type');
    expect(created.x).toBe(3);
    expect(created.y).toBe(4);
    expect(created.radius).toBe(5);
    expect(created.strokeType).toBe('solid');
    expect(created.strokeOpacity).toBe(1);
    expect(created.fillOpacity).toBe(0.3);
    expect(String(created.fillColor)).toBe('#009900');
  });

  it('arrow: createFromPointsはlineと同じpoints規約に矢じり設定を加えて生成する', () => {
    const created = asClickPointsModule(ANNOTATION_GEOMETRY.arrow).createFromPoints(
      1,
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      arrowStyle,
    );
    expect(created).not.toBeNull();
    if (!created || created.type !== 'arrow') throw new Error('unexpected type');
    expect(created.points).toEqual([0, 0, 10, 0]);
    expect(created.startHead).toBe('none');
    expect(created.endHead).toBe('triangle');
    expect(created.headSize).toBe(12);
    expect(created.strokeType).toBe('solid');
    expect(created.strokeOpacity).toBe(1);
  });

  it('createFromPointsは不正なstrokeColorに対してnullを返す', () => {
    const invalidStyle = { ...arrowStyle, strokeColor: 'not-a-color' };
    const created = asClickPointsModule(ANNOTATION_GEOMETRY.arrow).createFromPoints(
      1,
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      invalidStyle,
    );
    expect(created).toBeNull();
  });

  it('createFromPointsはstrokeColorが未設定（「線色なし」）でも有効な注釈を生成する', () => {
    const noColorStyle = { ...arrowStyle, strokeColor: undefined };
    const created = asClickPointsModule(ANNOTATION_GEOMETRY.arrow).createFromPoints(
      1,
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      noColorStyle,
    );
    expect(created).not.toBeNull();
    expect(created?.color).toBeUndefined();
  });

  it('box: boundingBoxはpadding分だけ外側に広がる', () => {
    const box = ANNOTATION_GEOMETRY.box.boundingBox({
      id: '00000000-0000-4000-8000-000000000000' as never,
      pageNumber: 1,
      x: 10,
      y: 10,
      color: '#000000' as never,
      strokeWidth: 2,
      strokeType: 'solid',
      blendMode: 'normal' as never,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      comment: {},
      type: 'box',
      width: 100,
      height: 50,
    });
    expect(box).toEqual({ x: 8, y: 8, width: 104, height: 54 });
  });

  it('arrow: boundingBoxはlineと同じ計算式（線幅を考慮した外接矩形）を使う', () => {
    const bbox = ANNOTATION_GEOMETRY.arrow.boundingBox({
      id: '00000000-0000-4000-8000-000000000000' as never,
      pageNumber: 1,
      x: 0,
      y: 0,
      color: '#000000' as never,
      strokeWidth: 4,
      strokeType: 'solid',
      blendMode: 'normal' as never,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      comment: {},
      type: 'arrow',
      points: [0, 0, 10, 0],
      startHead: 'none',
      endHead: 'triangle',
      headSize: 12,
    });
    expect(bbox.x).toBe(0);
    expect(bbox.y).toBe(0);
    expect(bbox.width).toBe(18);
    expect(bbox.height).toBe(8);
  });

  it('polyline: createFromPointsは先頭の頂点を原点とした相対座標配列を生成する', () => {
    const points = [
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 40 },
    ];
    const created = asClickPointsModule(ANNOTATION_GEOMETRY.polyline).createFromPoints(
      1,
      points,
      polylineStyle,
    );
    expect(created).not.toBeNull();
    if (!created || created.type !== 'polyline') throw new Error('unexpected type');
    expect(created.x).toBe(10);
    expect(created.y).toBe(10);
    expect(created.points).toEqual([0, 0, 20, 0, 20, 30]);
    expect(created.endHead).toBe('triangle');
    expect(created.strokeType).toBe('solid');
    expect(created.strokeOpacity).toBe(1);
  });

  it('polyline: createFromPointsは頂点が2未満の場合nullを返す', () => {
    const created = asClickPointsModule(ANNOTATION_GEOMETRY.polyline).createFromPoints(
      1,
      [{ x: 0, y: 0 }],
      polylineStyle,
    );
    expect(created).toBeNull();
  });

  it('polygon: createFromPointsは3頂点以上でアノテーションを生成する', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 10, y: 20 },
    ];
    const created = asClickPointsModule(ANNOTATION_GEOMETRY.polygon).createFromPoints(
      1,
      points,
      polygonStyle,
    );
    expect(created).not.toBeNull();
    if (!created || created.type !== 'polygon') throw new Error('unexpected type');
    expect(created.points).toEqual([0, 0, 20, 0, 10, 20]);
    expect(created.strokeOpacity).toBe(1);
    expect(created.fillOpacity).toBe(0.3);
    expect(created.strokeType).toBe('solid');
    expect(String(created.fillColor)).toBe('#9900cc');
  });

  it('polygon: createFromPointsは頂点が3未満の場合nullを返す', () => {
    const created = asClickPointsModule(ANNOTATION_GEOMETRY.polygon).createFromPoints(
      1,
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
      ],
      polygonStyle,
    );
    expect(created).toBeNull();
  });

  it('polygon: closableはtrue、polylineはfalse', () => {
    expect(asClickPointsModule(ANNOTATION_GEOMETRY.polygon).closable).toBeTrue();
    expect(asClickPointsModule(ANNOTATION_GEOMETRY.polyline).closable).toBeFalse();
  });

  it('text: createFromPointsは矩形サイズと初期値を持つテキストボックスを生成する', () => {
    const created = asClickPointsModule(ANNOTATION_GEOMETRY.text).createFromPoints(
      1,
      [
        { x: 10, y: 10 },
        { x: 110, y: 60 },
      ],
      textStyle,
    );
    expect(created).not.toBeNull();
    if (!created || created.type !== 'text') throw new Error('unexpected type');
    expect(created.width).toBe(100);
    expect(created.height).toBe(50);
    expect(created.text).toBe('');
    expect(created.fontFamily).toBe('sans-serif');
    expect(created.fontSize).toBe(16);
    expect(String(created.textColor)).toBe('#000000');
    expect(created.fillColor).toBeUndefined();
    expect(created.strokeType).toBe('solid');
  });

  it('text: boundingBoxはboxと同じくpadding分だけ外側に広がる', () => {
    const bbox = ANNOTATION_GEOMETRY.text.boundingBox({
      id: '00000000-0000-4000-8000-000000000000' as never,
      pageNumber: 1,
      x: 10,
      y: 10,
      color: '#000000' as never,
      strokeWidth: 0,
      strokeType: 'solid',
      blendMode: 'normal' as never,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      comment: {},
      type: 'text',
      width: 100,
      height: 50,
      text: 'hello',
      fontFamily: 'sans-serif',
      fontSize: 16,
      fontWeight: 400,
      textColor: '#000000' as never,
      textAlign: 'left',
    });
    expect(bbox).toEqual({ x: 8, y: 8, width: 104, height: 54 });
  });

  it('全種別のdefaultPresetsは1件以上存在する', () => {
    for (const [type, module] of Object.entries(ANNOTATION_GEOMETRY)) {
      expect(module.defaultPresets.length, `${type}のdefaultPresetsが空`).toBeGreaterThan(0);
    }
  });
});

describe('getSize / resizeTo（位置・サイズ操作盤向け）', () => {
  it('box: getSizeはwidth/heightをそのまま返し、resizeToはそれを直接更新する', () => {
    const style = {
      type: 'box' as const,
      id: '00000000-0000-4000-8000-000000000000' as never,
      pageNumber: 1,
      x: 0,
      y: 0,
      color: '#000000' as never,
      strokeWidth: 2,
      strokeType: 'solid' as const,
      blendMode: 'normal' as never,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      comment: {},
      width: 100,
      height: 50,
    };
    expect(ANNOTATION_GEOMETRY.box.getSize(style)).toEqual({ width: 100, height: 50 });
    expect(ANNOTATION_GEOMETRY.box.resizeTo(style, 200, 80)).toEqual({
      width: 200,
      height: 80,
    });
  });

  it('circle: getSizeは直径（radius*2）を返し、resizeToはradiusX/radiusYへ変換する', () => {
    const style = {
      type: 'circle' as const,
      id: '00000000-0000-4000-8000-000000000000' as never,
      pageNumber: 1,
      x: 0,
      y: 0,
      color: '#000000' as never,
      strokeWidth: 2,
      strokeType: 'solid' as const,
      blendMode: 'normal' as never,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      comment: {},
      radius: 10,
    };
    expect(ANNOTATION_GEOMETRY.circle.getSize(style)).toEqual({ width: 20, height: 20 });
    expect(ANNOTATION_GEOMETRY.circle.resizeTo(style, 40, 30)).toEqual({
      radiusX: 20,
      radiusY: 15,
    });
  });

  it('line: getSizeはpointsの絶対値を返し、resizeToは符号を保ったままサイズを変更する', () => {
    const style = {
      type: 'line' as const,
      id: '00000000-0000-4000-8000-000000000000' as never,
      pageNumber: 1,
      x: 0,
      y: 0,
      color: '#000000' as never,
      strokeWidth: 2,
      strokeType: 'solid' as const,
      blendMode: 'normal' as never,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      comment: {},
      points: [0, 0, -10, 20],
    };
    expect(ANNOTATION_GEOMETRY.line.getSize(style)).toEqual({ width: 10, height: 20 });
    expect(ANNOTATION_GEOMETRY.line.resizeTo(style, 30, 40)).toEqual({
      points: [0, 0, -30, 40],
    });
  });

  it('polygon: getSizeは全頂点の外接矩形の辺長を返し、resizeToは原点基準で比例縮尺する', () => {
    const style = {
      type: 'polygon' as const,
      id: '00000000-0000-4000-8000-000000000000' as never,
      pageNumber: 1,
      x: 0,
      y: 0,
      color: '#000000' as never,
      strokeWidth: 2,
      strokeType: 'solid' as const,
      blendMode: 'normal' as never,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      comment: {},
      points: [0, 0, 20, 0, 10, 20],
    };
    expect(ANNOTATION_GEOMETRY.polygon.getSize(style)).toEqual({ width: 20, height: 20 });
    expect(ANNOTATION_GEOMETRY.polygon.resizeTo(style, 40, 10)).toEqual({
      points: [0, 0, 40, 0, 20, 10],
    });
  });

  it('arrow: getSizeはpointsの絶対値を返し、resizeToは符号を保ったままサイズを変更する', () => {
    const style = {
      type: 'arrow' as const,
      id: '00000000-0000-4000-8000-000000000000' as never,
      pageNumber: 1,
      x: 0,
      y: 0,
      color: '#000000' as never,
      strokeWidth: 2,
      strokeType: 'solid' as const,
      blendMode: 'normal' as never,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      comment: {},
      points: [0, 0, -10, 20],
      startHead: 'none' as const,
      endHead: 'triangle' as const,
      headSize: 12,
    };
    expect(ANNOTATION_GEOMETRY.arrow.getSize(style)).toEqual({ width: 10, height: 20 });
    expect(ANNOTATION_GEOMETRY.arrow.resizeTo(style, 30, 40)).toEqual({
      points: [0, 0, -30, 40],
    });
  });

  it('polyline: getSizeは全頂点の外接矩形の辺長を返し、resizeToは原点基準で比例縮尺する', () => {
    const style = {
      type: 'polyline' as const,
      id: '00000000-0000-4000-8000-000000000000' as never,
      pageNumber: 1,
      x: 0,
      y: 0,
      color: '#000000' as never,
      strokeWidth: 2,
      strokeType: 'solid' as const,
      blendMode: 'normal' as never,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      comment: {},
      points: [0, 0, 20, 0, 20, 30],
      startHead: 'none' as const,
      endHead: 'triangle' as const,
      headSize: 12,
    };
    expect(ANNOTATION_GEOMETRY.polyline.getSize(style)).toEqual({ width: 20, height: 30 });
    expect(ANNOTATION_GEOMETRY.polyline.resizeTo(style, 40, 60)).toEqual({
      points: [0, 0, 40, 0, 40, 60],
    });
  });

  it('text: getSizeはwidth/heightをそのまま返し、resizeToはそれを直接更新する', () => {
    const style = {
      type: 'text' as const,
      id: '00000000-0000-4000-8000-000000000000' as never,
      pageNumber: 1,
      x: 0,
      y: 0,
      color: '#000000' as never,
      strokeWidth: 1,
      strokeType: 'solid' as const,
      blendMode: 'normal' as never,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      comment: {},
      width: 100,
      height: 50,
      text: 'hello',
      fontFamily: 'sans-serif',
      fontSize: 16,
      fontWeight: 400,
      textColor: '#000000' as never,
      textAlign: 'left' as const,
    };
    expect(ANNOTATION_GEOMETRY.text.getSize(style)).toEqual({ width: 100, height: 50 });
    expect(ANNOTATION_GEOMETRY.text.resizeTo(style, 200, 80)).toEqual({
      width: 200,
      height: 80,
    });
  });
});

describe('boundingBox（残りの種別）', () => {
  it('circle: boundingBoxはradiusX/radiusY未設定時、radiusを直径として使う', () => {
    const bbox = ANNOTATION_GEOMETRY.circle.boundingBox({
      id: '00000000-0000-4000-8000-000000000000' as never,
      pageNumber: 1,
      x: 10,
      y: 10,
      color: '#000000' as never,
      strokeWidth: 2,
      strokeType: 'solid',
      blendMode: 'normal' as never,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      comment: {},
      type: 'circle',
      radius: 5,
    });
    expect(bbox).toEqual({ x: 3, y: 3, width: 14, height: 14 });
  });

  it('polyline: boundingBoxは頂点群の外接矩形（線幅を考慮）を返す', () => {
    const bbox = ANNOTATION_GEOMETRY.polyline.boundingBox({
      id: '00000000-0000-4000-8000-000000000000' as never,
      pageNumber: 1,
      x: 0,
      y: 0,
      color: '#000000' as never,
      strokeWidth: 4,
      strokeType: 'solid',
      blendMode: 'normal' as never,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      comment: {},
      type: 'polyline',
      points: [0, 0, 20, 0, 20, 30],
      startHead: 'none',
      endHead: 'triangle',
      headSize: 12,
    });
    expect(bbox).toEqual({ x: 0, y: 0, width: 28, height: 38 });
  });

  it('polygon: boundingBoxは頂点群の外接矩形（線幅を考慮）を返す', () => {
    const bbox = ANNOTATION_GEOMETRY.polygon.boundingBox({
      id: '00000000-0000-4000-8000-000000000000' as never,
      pageNumber: 1,
      x: 0,
      y: 0,
      color: '#000000' as never,
      strokeWidth: 2,
      strokeType: 'solid',
      blendMode: 'normal' as never,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      comment: {},
      type: 'polygon',
      points: [0, 0, 20, 0, 10, 20],
    });
    expect(bbox).toEqual({ x: 0, y: 0, width: 26, height: 26 });
  });
});

describe('previewFromDrag / previewFromPoints（ドラッグ・クリック中のプレビュー形状）', () => {
  it('box: fill/strokeにstrokeOpacity/fillOpacityをrgba合成して返す', () => {
    const preview = asClickPointsModule(ANNOTATION_GEOMETRY.box).previewFromPoints(
      [{ x: 10, y: 20 }],
      { x: 30, y: 50 },
      boxStyle,
    );
    expect(preview).toEqual({
      x: 10,
      y: 20,
      width: 20,
      height: 30,
      fill: hexToRgba('#0000ff', 0.5),
      stroke: hexToRgba('#0000ff', 1),
      strokeWidth: 5,
    });
  });

  it('line: 塗りを持たないためstrokeのみをrgba合成して返す', () => {
    const preview = asClickPointsModule(ANNOTATION_GEOMETRY.line).previewFromPoints(
      [{ x: 5, y: 5 }],
      { x: 15, y: 25 },
      lineStyle,
    );
    expect(preview).toEqual({
      x: 5,
      y: 5,
      points: [0, 0, 10, 20],
      stroke: hexToRgba('#000000', 1),
      strokeWidth: 2,
    });
  });

  it('circle: fill/strokeにstrokeOpacity/fillOpacityをrgba合成して返す', () => {
    const preview = asClickPointsModule(ANNOTATION_GEOMETRY.circle).previewFromPoints(
      [{ x: 0, y: 0 }],
      { x: 6, y: 8 },
      circleStyle,
    );
    expect(preview).toEqual({
      x: 3,
      y: 4,
      radius: 5,
      fill: hexToRgba('#009900', 0.3),
      stroke: hexToRgba('#009900', 1),
      strokeWidth: 3,
    });
  });

  it('arrow: previewFromPointsはstroke/startHead/endHead/headSizeをそのまま返す（矢じりの合成描画はArrowLikePreviewShape.vue側が行う）', () => {
    const preview = asClickPointsModule(ANNOTATION_GEOMETRY.arrow).previewFromPoints(
      [{ x: 0, y: 0 }],
      { x: 10, y: 0 },
      arrowStyle,
    );
    expect(preview).toEqual({
      x: 0,
      y: 0,
      points: [0, 0, 10, 0],
      stroke: hexToRgba('#000000', 1),
      strokeWidth: 3,
      dash: undefined,
      startHead: 'none',
      endHead: 'triangle',
      headSize: 12,
    });
  });

  it('polyline: previewFromPointsは末尾にcursor座標を追加でき、stroke/startHead/endHead/headSizeをそのまま返す', () => {
    const points = [
      { x: 10, y: 10 },
      { x: 30, y: 10 },
    ];
    const withoutCursor = asClickPointsModule(ANNOTATION_GEOMETRY.polyline).previewFromPoints(
      points,
      null,
      polylineStyle,
    );
    expect(withoutCursor).toEqual({
      x: 10,
      y: 10,
      points: [0, 0, 20, 0],
      stroke: hexToRgba('#000000', 1),
      strokeWidth: 3,
      dash: undefined,
      startHead: 'none',
      endHead: 'triangle',
      headSize: 12,
    });

    const withCursor = asClickPointsModule(ANNOTATION_GEOMETRY.polyline).previewFromPoints(
      points,
      { x: 40, y: 10 },
      polylineStyle,
    );
    expect(withCursor.points).toEqual([0, 0, 20, 0, 30, 0]);
  });

  it('polygon: previewFromPointsは未確定の間は常にclosed=falseでfill/strokeをrgba合成する', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 10, y: 20 },
    ];
    const preview = asClickPointsModule(ANNOTATION_GEOMETRY.polygon).previewFromPoints(
      points,
      null,
      polygonStyle,
    );
    expect(preview).toEqual({
      x: 0,
      y: 0,
      points: [0, 0, 20, 0, 10, 20],
      // 3点以上あっても、始点への再クリックで確定するまでは絶対に閉じた図形に見せない
      closed: false,
      fill: hexToRgba('#9900cc', 0.3),
      stroke: hexToRgba('#9900cc', 1),
      strokeWidth: 3,
    });
  });

  it('polygon: 始点付近にカーソルがあり閉合可能な状態（closing）のときは閉じた図形として塗りを適用する', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 10, y: 20 },
    ];
    const preview = asClickPointsModule(ANNOTATION_GEOMETRY.polygon).previewFromPoints(
      points,
      { x: 1, y: 1 },
      polygonStyle,
      { closing: true },
    );
    expect(preview).toEqual({
      x: 0,
      y: 0,
      // closing中はカーソル位置（ほぼ始点）を余分な頂点として追加しない
      points: [0, 0, 20, 0, 10, 20],
      closed: true,
      fill: hexToRgba('#9900cc', 0.3),
      stroke: hexToRgba('#9900cc', 1),
      strokeWidth: 3,
    });
  });

  it('text: fillColor未設定の場合はtransparentを返す', () => {
    const preview = asClickPointsModule(ANNOTATION_GEOMETRY.text).previewFromPoints(
      [{ x: 10, y: 10 }],
      { x: 110, y: 60 },
      textStyle,
    );
    expect(preview).toEqual({
      x: 10,
      y: 10,
      width: 100,
      height: 50,
      fill: 'transparent',
      stroke: hexToRgba('#000000', 1),
      strokeWidth: 0,
    });
  });
});
