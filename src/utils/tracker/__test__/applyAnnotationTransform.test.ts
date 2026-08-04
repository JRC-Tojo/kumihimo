import { describe, expect, it } from 'bun:test';
import {
  AnnotationID,
  ColorCode,
  type BoxAnnotationStyle,
  type CircleAnnotationStyle,
  type LineAnnotationStyle,
} from 'src/models/document/pdf';
import type { SimilarityTransform } from '../similarityTransform';
import { transformAnnotationStyle } from '../applyAnnotationTransform';

const baseFields = {
  id: AnnotationID.parse('00000000-0000-4000-8000-000000000000'),
  pageNumber: 1,
  color: ColorCode.parse('#000000'),
  strokeWidth: 2,
  strokeType: 'solid' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  comment: {},
};

describe('transformAnnotationStyle', () => {
  it('box: 原点を平行移動し、width/heightをスケール倍する', () => {
    const style: BoxAnnotationStyle = {
      ...baseFields,
      type: 'box',
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    };
    const t: SimilarityTransform = { scale: 2, rotation: 0, tx: 5, ty: -5 };

    const result = transformAnnotationStyle(style, t);

    expect(result.type).toBe('box');
    expect(result.x).toBeCloseTo(25, 5); // 10*2+5
    expect(result.y).toBeCloseTo(35, 5); // 20*2-5
    if (result.type === 'box') {
      expect(result.width).toBeCloseTo(200, 5);
      expect(result.height).toBeCloseTo(100, 5);
    }
  });

  it('circle: 中心を変換し、radius/radiusX/radiusYをスケール倍する', () => {
    const style: CircleAnnotationStyle = {
      ...baseFields,
      type: 'circle',
      x: 0,
      y: 0,
      radius: 10,
      radiusX: 12,
      radiusY: 8,
    };
    const t: SimilarityTransform = { scale: 1.5, rotation: 0, tx: 100, ty: 200 };

    const result = transformAnnotationStyle(style, t);

    expect(result.x).toBeCloseTo(100, 5);
    expect(result.y).toBeCloseTo(200, 5);
    if (result.type === 'circle') {
      expect(result.radius).toBeCloseTo(15, 5);
      expect(result.radiusX).toBeCloseTo(18, 5);
      expect(result.radiusY).toBeCloseTo(12, 5);
    }
  });

  it('line: 回転を含む変換でも、原点相対のオフセットベクトルとして正しく回転・スケールされる', () => {
    const style: LineAnnotationStyle = {
      ...baseFields,
      type: 'line',
      x: 50,
      y: 50,
      points: [0, 0, 10, 0], // 起点から右方向に長さ10
    };
    // 90度回転（反時計回りではなくatan2の定義通り: x' = -y, y' = x）+ 2倍スケール
    const t: SimilarityTransform = { scale: 2, rotation: Math.PI / 2, tx: 0, ty: 0 };

    const result = transformAnnotationStyle(style, t);

    if (result.type === 'line') {
      // オフセット(10,0)は回転+スケールのみ適用され、(0, 20)相当になるはず
      expect(result.points[0]).toBeCloseTo(0, 4);
      expect(result.points[1]).toBeCloseTo(0, 4);
      expect(result.points[2]).toBeCloseTo(0, 4);
      expect(result.points[3]).toBeCloseTo(20, 4);
    }
  });

  it('恒等変換はアノテーションの座標を変えない', () => {
    const style: BoxAnnotationStyle = {
      ...baseFields,
      type: 'box',
      x: 42,
      y: 24,
      width: 30,
      height: 15,
    };
    const identity: SimilarityTransform = { scale: 1, rotation: 0, tx: 0, ty: 0 };

    const result = transformAnnotationStyle(style, identity);

    expect(result.x).toBeCloseTo(42, 6);
    expect(result.y).toBeCloseTo(24, 6);
    if (result.type === 'box') {
      expect(result.width).toBeCloseTo(30, 6);
      expect(result.height).toBeCloseTo(15, 6);
    }
  });
});
