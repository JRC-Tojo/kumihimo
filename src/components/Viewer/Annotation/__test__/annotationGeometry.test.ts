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

  it('arrow: boundingBoxはlineと同じ計算式（線幅を考慮した外接矩形）に加え、矢じりの張り出しも含める', () => {
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
    // シャフトの太さ（strokeWidth 4→halfStroke 2+padding 2=4）だけならheight=8だが、
    // headSize 12のtriangle矢じり（半幅6）の方が広く張り出すため、その分を含めてheight=12になる
    expect(bbox.height).toBe(12);
  });

  it('line: 始点アンカー（points[0]/points[1]）だけを動かした場合でもboundingBoxに反映される（Issue #76: 始点だけ動かすと関係性の読み取り値が更新されない不具合の回帰テスト）', () => {
    const baseStyle = {
      id: '00000000-0000-4000-8000-000000000000' as never,
      pageNumber: 1,
      // 外接矩形は負座標を0にクランプするため、始点移動によるx側の縮小がクランプで
      // 相殺されないよう、あらかじめ原点から離れた位置に置く
      x: 100,
      y: 100,
      color: '#000000' as never,
      strokeWidth: 2,
      strokeType: 'solid' as const,
      blendMode: 'normal' as never,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      comment: {},
      type: 'line' as const,
    };

    // 作成直後：始点は(x, y)そのもの、終点はそこから(10, 0)のオフセット
    const original = ANNOTATION_GEOMETRY.line.boundingBox({ ...baseStyle, points: [0, 0, 10, 0] });

    // 頂点アンカー（useTwoPointAnchors）で始点だけをドラッグした場合、x/yは変わらず
    // points[0]/points[1]だけが変化する（終点は据え置き）
    const startMoved = ANNOTATION_GEOMETRY.line.boundingBox({
      ...baseStyle,
      points: [-20, 0, 10, 0],
    });

    // 始点を動かした分だけ外接矩形の左端が広がっていること
    expect(startMoved).not.toEqual(original);
    expect(startMoved.x).toBe(original.x - 20);
    expect(startMoved.width).toBe(original.width + 20);
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

  it('polyline: 始点頂点（points[0]/points[1]）だけを動かした場合でもboundingBoxに反映される（Issue #76と同種の回帰テスト）', () => {
    const baseStyle = {
      id: '00000000-0000-4000-8000-000000000000' as never,
      pageNumber: 1,
      x: 100,
      y: 100,
      color: '#000000' as never,
      strokeWidth: 2,
      strokeType: 'solid' as const,
      blendMode: 'normal' as never,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      comment: {},
      type: 'polyline' as const,
      startHead: 'none' as const,
      endHead: 'none' as const,
      headSize: 12,
    };

    // 作成直後：始点は(x, y)そのもの、終点はそこから(20, 0)のオフセット
    const original = ANNOTATION_GEOMETRY.polyline.boundingBox({
      ...baseStyle,
      points: [0, 0, 20, 0],
    });

    // 頂点アンカー（useMultiPointAnchors）で始点だけをドラッグした場合、x/yは変わらず
    // points[0]/points[1]だけが変化する（終点は据え置き）。始点を既存範囲[0, 20]の内側
    // （旧実装ではx/yをそのまま範囲に含め続けてしまい、この移動が検知されなかった）へ動かす
    const startMoved = ANNOTATION_GEOMETRY.polyline.boundingBox({
      ...baseStyle,
      points: [10, 0, 20, 0],
    });

    expect(startMoved).not.toEqual(original);
    expect(startMoved.x).toBe(original.x + 10);
    expect(startMoved.width).toBe(original.width - 10);
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

/** containsPointテスト用の共通ベースフィールド（strokeWidthのみ呼び出し側で変える） */
function containsPointBaseFields(strokeWidth: number) {
  return {
    id: '00000000-0000-4000-8000-000000000000' as never,
    pageNumber: 1,
    color: '#000000' as never,
    strokeWidth,
    strokeType: 'solid' as const,
    blendMode: 'normal' as never,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    comment: {},
  };
}

describe('containsPoint（実形状に基づく点の内外判定。関係性のテキスト読み取り範囲や当たり判定の厳密化に使う。Issue #82）', () => {
  it('box: 面方向全体が制御可能なため、矩形の内側（境界含む）はtrueを返す', () => {
    const style = {
      ...containsPointBaseFields(2),
      type: 'box' as const,
      x: 10,
      y: 10,
      width: 20,
      height: 10,
    };
    expect(ANNOTATION_GEOMETRY.box.containsPoint(style, { x: 20, y: 15 })).toBeTrue();
    expect(ANNOTATION_GEOMETRY.box.containsPoint(style, { x: 10, y: 10 })).toBeTrue();
    expect(ANNOTATION_GEOMETRY.box.containsPoint(style, { x: 31, y: 15 })).toBeFalse();
  });

  it('circle: 面方向全体が制御可能なため、楕円の内側のみtrueを返す', () => {
    const style = {
      ...containsPointBaseFields(2),
      type: 'circle' as const,
      x: 0,
      y: 0,
      radius: 10,
    };
    expect(ANNOTATION_GEOMETRY.circle.containsPoint(style, { x: 5, y: 5 })).toBeTrue();
    expect(ANNOTATION_GEOMETRY.circle.containsPoint(style, { x: 9, y: 9 })).toBeFalse();
  });

  it('line: 外接矩形（AABB）の内側でも、実際の太さを超えて線から離れた点はfalseを返す', () => {
    // strokeWidth 6 → halfStroke = 6/2 = 3
    const style = {
      ...containsPointBaseFields(6),
      type: 'line' as const,
      x: 0,
      y: 0,
      points: [0, 0, 100, 100],
    };

    // 線分の中点は当然含まれる
    expect(ANNOTATION_GEOMETRY.line.containsPoint(style, { x: 50, y: 50 })).toBeTrue();

    // (95, 5)は外接矩形の内側だが、斜めの線からは大きく離れている
    // （旧実装のAABB判定ではここも「範囲内」とみなされ、誤ってテキストを拾ってしまっていた）
    const bbox = ANNOTATION_GEOMETRY.line.boundingBox(style);
    const farButInsideBBox = { x: 95, y: 5 };
    expect(farButInsideBBox.x).toBeLessThanOrEqual(bbox.x + bbox.width);
    expect(farButInsideBBox.y).toBeGreaterThanOrEqual(bbox.y);
    expect(ANNOTATION_GEOMETRY.line.containsPoint(style, farButInsideBBox)).toBeFalse();
  });

  it('arrow: lineと同じくシャフトの帯からの距離で判定する', () => {
    const style = {
      ...containsPointBaseFields(6),
      type: 'arrow' as const,
      x: 0,
      y: 0,
      points: [0, 0, 100, 100],
      startHead: 'none' as const,
      endHead: 'triangle' as const,
      headSize: 12,
    };
    expect(ANNOTATION_GEOMETRY.arrow.containsPoint(style, { x: 50, y: 50 })).toBeTrue();
    expect(ANNOTATION_GEOMETRY.arrow.containsPoint(style, { x: 95, y: 5 })).toBeFalse();
  });

  it('arrow: 矢じり（headSizeで線幅より外側へ張り出す部分）の内側もtrueを返す（Issue #82の回帰テスト）', () => {
    // シャフトは水平（0,0)-(20,0)）、strokeWidth 2 → halfStroke = 1
    const style = {
      ...containsPointBaseFields(2),
      type: 'arrow' as const,
      x: 0,
      y: 0,
      points: [0, 0, 20, 0],
      startHead: 'none' as const,
      endHead: 'triangle' as const,
      headSize: 12,
    };

    // (12, 3)はシャフトの帯（|y| <= 1）からは外れているが、終点(20,0)に付く
    // triangle矢じり（半幅6の三角形）の内側にあるため、trueを返すべき
    expect(ANNOTATION_GEOMETRY.arrow.containsPoint(style, { x: 12, y: 3 })).toBeTrue();
    // (25, 0)は矢じりの先端(20,0)よりさらに外側で、シャフトの延長にも矢じりの三角形にも含まれない
    expect(ANNOTATION_GEOMETRY.arrow.containsPoint(style, { x: 25, y: 0 })).toBeFalse();
  });

  it('polyline: 各線分から実際の太さ分だけ離れた範囲のみtrueを返す', () => {
    // strokeWidth 4 → halfStroke = 4/2 = 2
    const style = {
      ...containsPointBaseFields(4),
      type: 'polyline' as const,
      x: 0,
      y: 0,
      points: [0, 0, 20, 0, 20, 30],
      startHead: 'none' as const,
      endHead: 'none' as const,
      headSize: 12,
    };
    // 1本目の線分（0,0)-(20,0)）上の点
    expect(ANNOTATION_GEOMETRY.polyline.containsPoint(style, { x: 10, y: 0 })).toBeTrue();
    // どちらの線分からも離れた、外接矩形内の点
    expect(ANNOTATION_GEOMETRY.polyline.containsPoint(style, { x: 10, y: 20 })).toBeFalse();
  });

  it('polygon: 塗りがある場合は面の内側も対象に含み、塗りが無い場合は輪郭線付近のみが対象になる', () => {
    // strokeWidth 2 → halfStroke = 2/2 = 1
    const filled = {
      ...containsPointBaseFields(2),
      type: 'polygon' as const,
      x: 0,
      y: 0,
      points: [0, 0, 20, 0, 10, 20],
      fillColor: '#9900cc' as never,
    };
    const unfilled = { ...filled, fillColor: undefined };

    // 三角形の重心付近（いずれの辺からも離れた内部の点）
    const insidePoint = { x: 10, y: 8 };
    expect(ANNOTATION_GEOMETRY.polygon.containsPoint(filled, insidePoint)).toBeTrue();
    expect(ANNOTATION_GEOMETRY.polygon.containsPoint(unfilled, insidePoint)).toBeFalse();

    // 輪郭線上の点は、塗りの有無に関わらず対象に含む
    const edgePoint = { x: 10, y: 0 };
    expect(ANNOTATION_GEOMETRY.polygon.containsPoint(filled, edgePoint)).toBeTrue();
    expect(ANNOTATION_GEOMETRY.polygon.containsPoint(unfilled, edgePoint)).toBeTrue();
  });

  it('text: boxと同じく矩形の内側（境界含む）のみtrueを返す', () => {
    const style = {
      ...containsPointBaseFields(0),
      type: 'text' as const,
      x: 10,
      y: 10,
      width: 20,
      height: 10,
      text: 'hello',
      fontFamily: 'sans-serif',
      fontSize: 16,
      fontWeight: 400,
      textColor: '#000000' as never,
      textAlign: 'left' as const,
    };
    expect(ANNOTATION_GEOMETRY.text.containsPoint(style, { x: 20, y: 15 })).toBeTrue();
    expect(ANNOTATION_GEOMETRY.text.containsPoint(style, { x: 100, y: 100 })).toBeFalse();
  });
});

describe('containsPoint（大判文書での誤認識対策: 進行方向の端部の厳密カット・pointSize指定時の直交方向の厳密判定）', () => {
  it('line: 進行方向の延長線上にある点は、旧実装なら丸めキャップ内に収まる場合でも常にfalseを返す', () => {
    // 水平線 (0,0)-(100,0)、strokeWidth 6 → halfStroke = 3
    const style = {
      ...containsPointBaseFields(6),
      type: 'line' as const,
      x: 0,
      y: 0,
      points: [0, 0, 100, 0],
    };

    // (102, 2): 終点(100,0)からの直線距離は約2.83で旧実装（丸めキャップ）ならhalfStroke(3)以内だが、
    // 進行方向では終点を2だけ超えているため、端部を厳密に切る新実装ではfalseを返すべき
    expect(ANNOTATION_GEOMETRY.line.containsPoint(style, { x: 102, y: 2 })).toBeFalse();
    // 対照として、同じ直交距離2でも進行方向が線分の範囲内（x=98）ならtrueを返す
    expect(ANNOTATION_GEOMETRY.line.containsPoint(style, { x: 98, y: 2 })).toBeTrue();
  });

  it('line: pointSizeを渡し、直交方向のサイズが線幅に収まる場合は実形状が帯へ完全に収まっているかで厳密に判定する', () => {
    // 水平線 (0,0)-(100,0)、strokeWidth 10 → halfStroke = 5
    const style = {
      ...containsPointBaseFields(10),
      type: 'line' as const,
      x: 0,
      y: 0,
      points: [0, 0, 100, 0],
    };

    // 高さ6（<= strokeWidth 10なので「線幅に収まる」）の文字要素。中心は帯の中心線から3離れている
    // だけで、pointSizeを渡さない場合は|perp|<=5を満たすためtrueになってしまうが、
    // 文字の上端（perp + height/2 = 3 + 3 = 6）は帯（halfStroke=5）からはみ出しているため、
    // 拡張を考慮しない厳密判定ではfalseを返すべき（隣接する行の文字を誤って拾わないための挙動）
    const pointSize = { width: 4, height: 6 };
    expect(ANNOTATION_GEOMETRY.line.containsPoint(style, { x: 50, y: 3 }, pointSize)).toBeFalse();
    // 中心が帯の中心線から2の位置なら、上端(2+3=5)がちょうど帯に収まるためtrueを返す
    expect(ANNOTATION_GEOMETRY.line.containsPoint(style, { x: 50, y: 2 }, pointSize)).toBeTrue();
  });

  it('line: pointSize指定時は文字矩形の進行方向の端も線分範囲内に収める', () => {
    // 水平線 (0,0)-(100,0)、strokeWidth 10 → halfStroke = 5
    const style = {
      ...containsPointBaseFields(10),
      type: 'line' as const,
      x: 0,
      y: 0,
      points: [0, 0, 100, 0],
    };

    const pointSize = { width: 4, height: 6 };
    // 中心は終点から内側にあるが、文字矩形の右端が線分の終点を越えるためfalse
    expect(ANNOTATION_GEOMETRY.line.containsPoint(style, { x: 99, y: 0 }, pointSize)).toBeFalse();
    // 文字矩形の右端が終点にちょうど接する場合はtrue
    expect(ANNOTATION_GEOMETRY.line.containsPoint(style, { x: 98, y: 0 }, pointSize)).toBeTrue();
  });

  it('line: pointSizeを渡しても、直交方向のサイズが線幅に収まらない場合はpointSize省略時と同じ（多少の拡張を許容する）判定になる', () => {
    // 水平線 (0,0)-(100,0)、strokeWidth 4 → halfStroke = 2
    const style = {
      ...containsPointBaseFields(4),
      type: 'line' as const,
      x: 0,
      y: 0,
      points: [0, 0, 100, 0],
    };

    // 高さ10（> strokeWidth 4なので「線幅に収まらない」、A4文書の大きな文字を想定）の文字要素。
    // 中心が帯の中心線から1.5（halfStroke 2以内）の位置なら、文字全体は帯に収まっていなくても
    // 現状と同じ拡張ありの判定でtrueを返すべき
    const pointSize = { width: 8, height: 10 };
    expect(ANNOTATION_GEOMETRY.line.containsPoint(style, { x: 50, y: 1.5 }, pointSize)).toBeTrue();
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
