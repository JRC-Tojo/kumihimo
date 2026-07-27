import { describe, expect, it } from 'bun:test';
import {
  applyTransform,
  estimateSimilarityRansac,
  type SimilarityTransform,
} from '../similarityTransform';
import type { Point } from 'src/components/Viewer/Annotation/annotationGeometry';

function transformPoints(points: Point[], t: SimilarityTransform): Point[] {
  return points.map((p) => applyTransform(t, p));
}

describe('estimateSimilarityRansac', () => {
  it('平行移動のみの対応点から変換を正しく復元できる', () => {
    const oldPoints: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
    ];
    const truth: SimilarityTransform = { scale: 1, rotation: 0, tx: 20, ty: -10 };
    const newPoints = transformPoints(oldPoints, truth);

    const estimate = estimateSimilarityRansac(oldPoints, newPoints);

    expect(estimate).not.toBeNull();
    expect(estimate!.transform.scale).toBeCloseTo(truth.scale, 5);
    expect(estimate!.transform.rotation).toBeCloseTo(truth.rotation, 5);
    expect(estimate!.transform.tx).toBeCloseTo(truth.tx, 5);
    expect(estimate!.transform.ty).toBeCloseTo(truth.ty, 5);
    expect(estimate!.inlierRatio).toBe(1);
  });

  it('回転・拡大縮小・平行移動を組み合わせた変換を正しく復元できる', () => {
    const oldPoints: Point[] = [
      { x: 10, y: 5 },
      { x: 120, y: 30 },
      { x: 40, y: 200 },
      { x: 300, y: 150 },
      { x: 60, y: 80 },
    ];
    const truth: SimilarityTransform = { scale: 1.2, rotation: 0.15, tx: 5, ty: 30 };
    const newPoints = transformPoints(oldPoints, truth);

    const estimate = estimateSimilarityRansac(oldPoints, newPoints);

    expect(estimate).not.toBeNull();
    expect(estimate!.transform.scale).toBeCloseTo(truth.scale, 4);
    expect(estimate!.transform.rotation).toBeCloseTo(truth.rotation, 4);
    expect(estimate!.transform.tx).toBeCloseTo(truth.tx, 3);
    expect(estimate!.transform.ty).toBeCloseTo(truth.ty, 3);
  });

  it('外れ値が混入していてもRANSACによりロバストに変換を推定できる', () => {
    const oldPoints: Point[] = Array.from({ length: 12 }, (_, i) => ({
      x: (i % 4) * 50,
      y: Math.floor(i / 4) * 50,
    }));
    const truth: SimilarityTransform = { scale: 0.9, rotation: -0.1, tx: 15, ty: -8 };
    const newPoints = transformPoints(oldPoints, truth);

    // 外れ値を2点混入させる（全12点中2点、閾値0.3のinlierRatioを下回らない範囲）
    newPoints[0] = { x: 9999, y: -9999 };
    newPoints[1] = { x: -5000, y: 4000 };

    const estimate = estimateSimilarityRansac(oldPoints, newPoints);

    expect(estimate).not.toBeNull();
    expect(estimate!.transform.scale).toBeCloseTo(truth.scale, 3);
    expect(estimate!.transform.rotation).toBeCloseTo(truth.rotation, 3);
    expect(estimate!.inlierCount).toBeGreaterThanOrEqual(10);
  });

  it('対応点が1組以下の場合はnullを返す', () => {
    expect(estimateSimilarityRansac([], [])).toBeNull();
    expect(estimateSimilarityRansac([{ x: 0, y: 0 }], [{ x: 1, y: 1 }])).toBeNull();
  });

  it('インライア率が閾値未満の場合はnullを返す', () => {
    const oldPoints: Point[] = Array.from({ length: 10 }, (_, i) => ({ x: i * 10, y: 0 }));
    // 完全にランダムな対応点（一貫した変換が存在しない）
    const newPoints: Point[] = [
      { x: 500, y: -200 },
      { x: -300, y: 400 },
      { x: 100, y: 900 },
      { x: -700, y: -100 },
      { x: 250, y: 250 },
      { x: -450, y: 600 },
      { x: 800, y: 50 },
      { x: -900, y: -400 },
      { x: 300, y: -600 },
      { x: -100, y: 700 },
    ];

    const estimate = estimateSimilarityRansac(oldPoints, newPoints, { minInlierRatio: 0.8 });
    expect(estimate).toBeNull();
  });
});

describe('applyTransform', () => {
  it('恒等変換は座標を変えない', () => {
    const identity: SimilarityTransform = { scale: 1, rotation: 0, tx: 0, ty: 0 };
    const p = { x: 12.5, y: -7.3 };
    expect(applyTransform(identity, p)).toEqual(p);
  });
});
