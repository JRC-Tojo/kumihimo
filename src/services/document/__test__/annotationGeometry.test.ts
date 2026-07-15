import { describe, expect, it } from 'bun:test';
import { ANNOTATION_GEOMETRY } from '../annotationGeometry';
import type { DrawingAnnotationStyle } from 'src/models/docPage';

const boxStyle: DrawingAnnotationStyle = {
  type: 'box',
  strokeColor: '#0000ff',
  strokeWidth: 5,
  strokeType: 'solid',
  strokeOpacity: 1,
  fillColor: '#0000ff',
  fillPattern: 'solid',
  fillOpacity: 0.5,
};

const lineStyle: DrawingAnnotationStyle = {
  type: 'line',
  strokeColor: '#000000',
  strokeWidth: 2,
  strokeType: 'solid',
  strokeOpacity: 1,
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
};

describe('ANNOTATION_GEOMETRY', () => {
  it('box: createFromDragはドラッグ矩形からwidth/heightを計算する', () => {
    const created = ANNOTATION_GEOMETRY.box.createFromDrag(1, { x: 10, y: 20 }, { x: 30, y: 50 }, boxStyle);
    expect(created).not.toBeNull();
    if (!created || created.type !== 'box') throw new Error('unexpected type');
    expect(created.x).toBe(10);
    expect(created.y).toBe(20);
    expect(created.width).toBe(20);
    expect(created.height).toBe(30);
  });

  it('line: createFromDragはstartを起点としたpointsを生成する', () => {
    const created = ANNOTATION_GEOMETRY.line.createFromDrag(1, { x: 5, y: 5 }, { x: 15, y: 25 }, lineStyle);
    expect(created).not.toBeNull();
    if (!created || created.type !== 'line') throw new Error('unexpected type');
    expect(created.x).toBe(5);
    expect(created.y).toBe(5);
    expect(created.points).toEqual([0, 0, 10, 20]);
  });

  it('circle: createFromDragはドラッグの中点と半径を計算する', () => {
    const created = ANNOTATION_GEOMETRY.circle.createFromDrag(1, { x: 0, y: 0 }, { x: 6, y: 8 }, circleStyle);
    expect(created).not.toBeNull();
    if (!created || created.type !== 'circle') throw new Error('unexpected type');
    expect(created.x).toBe(3);
    expect(created.y).toBe(4);
    expect(created.radius).toBe(5);
  });

  it('arrow: createFromDragはlineと同じpoints規約に矢じり設定を加えて生成する', () => {
    const created = ANNOTATION_GEOMETRY.arrow.createFromDrag(1, { x: 0, y: 0 }, { x: 10, y: 0 }, arrowStyle);
    expect(created).not.toBeNull();
    if (!created || created.type !== 'arrow') throw new Error('unexpected type');
    expect(created.points).toEqual([0, 0, 10, 0]);
    expect(created.startHead).toBe('none');
    expect(created.endHead).toBe('triangle');
    expect(created.headSize).toBe(12);
  });

  it('createFromDragは不正なstrokeColorに対してnullを返す', () => {
    const invalidStyle = { ...arrowStyle, strokeColor: 'not-a-color' };
    const created = ANNOTATION_GEOMETRY.arrow.createFromDrag(1, { x: 0, y: 0 }, { x: 10, y: 0 }, invalidStyle);
    expect(created).toBeNull();
  });

  it('box: boundingBoxはpadding分だけ外側に広がる', () => {
    const box = ANNOTATION_GEOMETRY.box.boundingBox({
      id: '00000000-0000-4000-8000-000000000000' as never,
      pageNumber: 1,
      x: 10,
      y: 10,
      color: '#000000' as never,
      strokeWidth: 2,
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
});
