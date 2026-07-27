/**
 * LightGlue-ONNX（SuperPoint+LightGlue統合モデル）のInferenceSessionをシングルトンで管理する
 *
 * モデルファイル（`public/models/superpoint_lightglue_pipeline.onnx`、出典は
 * https://github.com/fabio-sim/LightGlue-ONNX v2.0リリース成果物、Apache-2.0。詳細は
 * `public/models/NOTICE.md`）は現状このリポジトリに同梱している（約51MB）。
 *
 * 本来はPaddleOCR（`ppu-paddle-ocr`）と同様、CDN等からのオンデマンド取得にしたいが、
 * GitHub Releasesの公式配布URLはCORS未対応（`Access-Control-Allow-Origin`ヘッダが
 * 無い）ため、ブラウザから直接`fetch`できない（確認済み）。CORSが有効な配信先
 * （利用者が管理するオブジェクトストレージ/CDN等）を用意できたら、`LIGHTGLUE_MODEL_URL`を
 * そのURLに差し替え、`public/models/`の同梱ファイルを削除すればよい（このモジュールの
 * インターフェース自体はURL文字列を変えるだけで済むようにしてある）。
 *
 * 未配置・読み込み失敗時はFailureを返す。呼び出し側（trackPdfAnnot.ts）はこれを
 * 「追跡不可（元の座標のまま採用）」のフォールバック条件として扱う
 */

import * as ort from 'onnxruntime-web';
import { Failure, Success, toError, type Result } from 'src/models/error/result';

/**
 * モデルファイルの参照先。現状は`public/`直下の同梱ファイル（Quasarが静的配信するパス）。
 * オンデマンド取得に切り替える際はここをCORS対応済みの外部URLに変更する
 */
export const LIGHTGLUE_MODEL_URL = '/models/superpoint_lightglue_pipeline.onnx';

// セッション初期化Promiseをキャッシュする（失敗時は次回呼び出しで再試行可能にする）
let sessionPromise: Promise<Result<ort.InferenceSession>> | undefined;

async function createSession(): Promise<Result<ort.InferenceSession>> {
  try {
    const session = await ort.InferenceSession.create(LIGHTGLUE_MODEL_URL, {
      executionProviders: ['wasm'],
    });
    return Success(session);
  } catch (e) {
    return Failure(toError(e));
  }
}

/**
 * LightGlue-ONNXセッションを取得する
 *
 * 初回のみモデルをロードし、以降は再利用する。ロードに失敗した場合はキャッシュを残さず、
 * 次回呼び出しで再試行できるようにする（モデルファイルを後から配置した場合に反映されるように）
 */
export async function getLightGlueSession(): Promise<Result<ort.InferenceSession>> {
  if (sessionPromise === undefined) {
    sessionPromise = createSession().then((res) => {
      if (!res.ok) sessionPromise = undefined;
      return res;
    });
  }
  return sessionPromise;
}
