/**
 * 新旧2枚のページ画像をLightGlue-ONNXでマッチングし、対応する特徴点座標のペアを求める
 *
 * 出力テンソルの正確な名前・形状は、実際にダウンロードしたONNXモデルファイルの
 * `session.outputNames`や各出力の`dims`で必ず確認すること（LightGlue-ONNXのエクスポート
 * オプションによって多少異なる可能性があるため、ここでの想定（`keypoints`/`matches`/`mscores`、
 * `matches`は`[num, 3]`で各行`[status, oldIdx, newIdx]`）は暫定。想定と異なる場合は
 * このファイルの`extractKeypoints`/`matchPageImages`内の抽出ロジックのみ調整すればよい
 */

import type * as ort from 'onnxruntime-web';
import { Failure, Success, toError, type Result } from 'src/models/error/result';
import type { Point } from 'src/components/Viewer/Annotation/annotationGeometry';
import { getLightGlueSession } from './lightglueSession';
import { buildPairTensor, unletterbox } from './imagePreprocess';

/** モデル入力の一辺サイズ（LightGlue-ONNXのCLI既定値に合わせる） */
const MODEL_INPUT_SIZE = 1024;
/** マッチの信頼度スコア下限。これ未満のペアは変換推定に使わない */
const MIN_MATCH_SCORE = 0.2;

export interface PageMatchResult {
  oldPoints: Point[];
  newPoints: Point[];
  scores: number[];
}

/** keypoints出力（形状`[2, numKeypoints, 2]`を想定）から、指定画像インデックス分の座標配列を取り出す */
function extractKeypoints(tensor: ort.Tensor, imageIndex: number): Point[] {
  const dims = tensor.dims;
  const numKeypoints = dims[1] ?? 0;
  const data = tensor.data as ArrayLike<number | bigint>;
  const base = imageIndex * numKeypoints * 2;

  const points: Point[] = [];
  for (let i = 0; i < numKeypoints; i++) {
    points.push({ x: Number(data[base + i * 2]), y: Number(data[base + i * 2 + 1]) });
  }
  return points;
}

/**
 * 新旧ページのCanvasから対応する特徴点座標ペアを求める
 *
 * モデル未配置・読み込み失敗・出力形式不整合時はFailureを返す。呼び出し側は
 * これを「このページは自動追跡できない」条件として扱う
 */
export async function matchPageImages(
  oldCanvas: HTMLCanvasElement,
  newCanvas: HTMLCanvasElement,
): Promise<Result<PageMatchResult>> {
  const sessionRes = await getLightGlueSession();
  if (!sessionRes.ok) return sessionRes;

  try {
    const { tensor, infoA, infoB } = buildPairTensor(oldCanvas, newCanvas, MODEL_INPUT_SIZE);
    const outputs = await sessionRes.value.run({ images: tensor });

    const keypointsTensor = outputs.keypoints;
    const matchesTensor = outputs.matches;
    const scoresTensor = outputs.mscores;
    if (!keypointsTensor || !matchesTensor || !scoresTensor) {
      return Failure(
        new Error(
          'LightGlueモデルの出力形式が想定と異なります（keypoints/matches/mscoresが見つかりません）',
        ),
      );
    }

    const oldKeypoints = extractKeypoints(keypointsTensor, 0);
    const newKeypoints = extractKeypoints(keypointsTensor, 1);

    const matchData = matchesTensor.data as ArrayLike<number | bigint>;
    const scoreData = scoresTensor.data as ArrayLike<number | bigint>;
    const matchDims = matchesTensor.dims;
    const numMatches = matchDims[0] ?? 0;
    // 想定形式は[num, 3]（status, oldIdx, newIdx）。[num, 2]（oldIdx, newIdxのみ）の場合にも対応する
    const cols = matchDims[1] ?? 3;
    const hasStatusColumn = cols >= 3;

    const oldPoints: Point[] = [];
    const newPoints: Point[] = [];
    const scores: number[] = [];

    for (let i = 0; i < numMatches; i++) {
      const status = hasStatusColumn ? Number(matchData[i * cols]) : 0;
      if (status < 0) continue; // 負値は「マッチなし」を表す慣例に合わせる

      const oldIdx = Number(matchData[i * cols + (hasStatusColumn ? 1 : 0)]);
      const newIdx = Number(matchData[i * cols + (hasStatusColumn ? 2 : 1)]);
      const score = Number(scoreData[i] ?? 0);
      if (score < MIN_MATCH_SCORE) continue;

      const oldKp = oldKeypoints[oldIdx];
      const newKp = newKeypoints[newIdx];
      if (!oldKp || !newKp) continue;

      oldPoints.push(unletterbox(oldKp, infoA));
      newPoints.push(unletterbox(newKp, infoB));
      scores.push(score);
    }

    return Success({ oldPoints, newPoints, scores });
  } catch (e) {
    return Failure(toError(e));
  }
}
