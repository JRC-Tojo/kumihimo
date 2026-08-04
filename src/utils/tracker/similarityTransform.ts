/**
 * 相似変換（拡大縮小・回転・平行移動）の推定
 *
 * 文書更新前後のページ画像から得た特徴点の対応点集合には誤マッチ（外れ値）が
 * 含まれ得るため、RANSACで外れ値を除去したうえで、インライア集合全体に対する
 * 最小二乗（Umeyama法）で最終的な変換を求める
 */

import type { Point } from 'src/components/Viewer/Annotation/annotationGeometry';

export interface SimilarityTransform {
  scale: number;
  /** 回転角（ラジアン） */
  rotation: number;
  tx: number;
  ty: number;
}

export interface SimilarityEstimate {
  transform: SimilarityTransform;
  inlierCount: number;
  inlierRatio: number;
}

export interface RansacOptions {
  /** インライア判定の許容誤差（ページ画像のピクセル単位） */
  inlierThreshold?: number;
  /** サンプリング試行回数 */
  iterations?: number;
  /** この割合未満のインライアしか得られない場合は推定失敗（null）とみなす */
  minInlierRatio?: number;
}

const DEFAULT_OPTIONS: Required<RansacOptions> = {
  inlierThreshold: 6,
  iterations: 200,
  minInlierRatio: 0.3,
};

/** 変換を1点に適用する（回転→拡大縮小→平行移動の順） */
export function applyTransform(t: SimilarityTransform, p: Point): Point {
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  return {
    x: t.scale * (cos * p.x - sin * p.y) + t.tx,
    y: t.scale * (sin * p.x + cos * p.y) + t.ty,
  };
}

/**
 * 対応点集合（2組以上）から最小二乗で相似変換を求める（Umeyama法の2次元・非鏡映版）
 *
 * 分散が0（全点が同一座標）の場合や対応点が2組未満の場合はnullを返す
 */
function fitSimilarityLeastSquares(oldPts: Point[], newPts: Point[]): SimilarityTransform | null {
  const n = oldPts.length;
  if (n < 2 || newPts.length !== n) return null;

  let oldMeanX = 0;
  let oldMeanY = 0;
  let newMeanX = 0;
  let newMeanY = 0;
  for (let i = 0; i < n; i++) {
    oldMeanX += oldPts[i]!.x;
    oldMeanY += oldPts[i]!.y;
    newMeanX += newPts[i]!.x;
    newMeanY += newPts[i]!.y;
  }
  oldMeanX /= n;
  oldMeanY /= n;
  newMeanX /= n;
  newMeanY /= n;

  // A = Σ(ox*nx + oy*ny), B = Σ(ox*ny - oy*nx)。回転角はatan2(B,A)で最小二乗最適になる
  let a = 0;
  let b = 0;
  let varOld = 0;
  for (let i = 0; i < n; i++) {
    const ox = oldPts[i]!.x - oldMeanX;
    const oy = oldPts[i]!.y - oldMeanY;
    const nx = newPts[i]!.x - newMeanX;
    const ny = newPts[i]!.y - newMeanY;
    a += ox * nx + oy * ny;
    b += ox * ny - oy * nx;
    varOld += ox * ox + oy * oy;
  }
  if (varOld <= 1e-9) return null;

  const rotation = Math.atan2(b, a);
  const scale = Math.sqrt(a * a + b * b) / varOld;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const tx = newMeanX - scale * (cos * oldMeanX - sin * oldMeanY);
  const ty = newMeanY - scale * (sin * oldMeanX + cos * oldMeanY);

  return { scale, rotation, tx, ty };
}

/**
 * RANSACにより外れ値を含む対応点集合から相似変換をロバストに推定する
 *
 * 最小サンプル（2点）から候補変換を多数生成し、インライア数が最大のものを採用したうえで、
 * そのインライア集合全体で最小二乗により再フィットする。対応点が少なすぎる場合や
 * インライア率が低すぎる場合はnullを返し、呼び出し側でそのページの追跡失敗として扱わせる
 */
export function estimateSimilarityRansac(
  oldPoints: Point[],
  newPoints: Point[],
  options: RansacOptions = {},
): SimilarityEstimate | null {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const n = oldPoints.length;
  if (n < 2 || newPoints.length !== n) return null;

  // 点数が少ない場合はサンプリングの意味が薄いため、全点を使った最小二乗のみで済ませる
  if (n <= 3) {
    const transform = fitSimilarityLeastSquares(oldPoints, newPoints);
    if (!transform) return null;
    return { transform, inlierCount: n, inlierRatio: 1 };
  }

  let bestInlierIndices: number[] = [];

  for (let iter = 0; iter < opts.iterations; iter++) {
    const i = Math.floor(Math.random() * n);
    let j = Math.floor(Math.random() * n);
    if (j === i) j = (j + 1) % n;

    const candidate = fitSimilarityLeastSquares(
      [oldPoints[i]!, oldPoints[j]!],
      [newPoints[i]!, newPoints[j]!],
    );
    if (!candidate) continue;

    const inlierIndices: number[] = [];
    for (let k = 0; k < n; k++) {
      const predicted = applyTransform(candidate, oldPoints[k]!);
      const dx = predicted.x - newPoints[k]!.x;
      const dy = predicted.y - newPoints[k]!.y;
      if (Math.sqrt(dx * dx + dy * dy) <= opts.inlierThreshold) inlierIndices.push(k);
    }

    if (inlierIndices.length > bestInlierIndices.length) bestInlierIndices = inlierIndices;
  }

  const inlierRatio = bestInlierIndices.length / n;
  if (bestInlierIndices.length < 2 || inlierRatio < opts.minInlierRatio) return null;

  const refit = fitSimilarityLeastSquares(
    bestInlierIndices.map((k) => oldPoints[k]!),
    bestInlierIndices.map((k) => newPoints[k]!),
  );
  if (!refit) return null;

  return { transform: refit, inlierCount: bestInlierIndices.length, inlierRatio };
}
