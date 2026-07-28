/**
 * `runVisionTask`（汎用ONNXビジョン言語モデル実行ユーティリティ）が、実際に
 * "onnx-community/GLM-OCR-ONNX"を使って数式を正しく読み取れるかどうかを検証する
 *
 * 本体（Rustプラグイン）実装より前に、まずこのモデルで実用に足る精度が出るかどうかを
 * 確認するためのテスト。`src/utils/ocr/__test__/ocr.test.ts`（既存のPaddleOCRモデル検証）と
 * 同様に、実際のモデルをダウンロード・実行する結合テストとして`bun test`スイートに含める。
 * 初回はモデル本体（数百MB）のダウンロードが発生するため時間がかかる
 *
 * `runVisionTask`はcanvas（本番のページ画像）またはURL/ファイルパス文字列のどちらも
 * 受け付けるが、このテストでは後者（実画像ファイルのパス）を直接渡す。transformers.jsの
 * `RawImage.fromCanvas`はブラウザ環境判定（`apis.IS_WEB_ENV`）に依存しNode.js上では
 * 常に例外を投げるため、canvasを使った経路はNode.js上のテストでは検証できない
 * （実機検証で確認済み）。canvas入力そのものの受け渡しより、モデルの読み取り精度の検証が
 * このテストの目的のため、ファイルパスを直接渡す経路で十分に検証できる
 *
 * GLM-OCR-ONNXの生出力は、数式を"$...$"（インラインLaTeX）で囲む場合と囲わない場合が
 * あり、複数桁の数字が"1 2"のように桁ごとに空白区切りで出力されることがある（実機検証で
 * 確認済みの既知の癖）。そのため期待値との比較は、空白と"$"を取り除いた正規化後の文字列に
 * 対して行う（完全一致ではなく、桁の空白癖を許容する）
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'path';
import { mkdirSync, existsSync, writeFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { env } from '@huggingface/transformers';
import { runVisionTask } from '../main';

const VISION_ASSETS_DIR = join(import.meta.dir, 'visionAssets');
const MODEL_ID = 'onnx-community/GLM-OCR-ONNX';
const DTYPE_SUFFIX = 'q4f16';

/**
 * `@huggingface/transformers`（v4.2.0）をNode.js上で実行する場合、外部データ形式
 * （`*.onnx_data`）を使うモデルのダウンローダが、なぜか`.onnx`（グラフ本体）だけを
 * フェッチして`.onnx_data`（実際の重み）を一切フェッチせず、onnxruntime-node側の
 * セッション初期化が「ファイルが見つからない」エラーで失敗する不具合を実機検証で確認した
 * （"onnx-community/GLM-OCR-ONNX"のq4/q4f16/デフォルト各dtypeで再現）。ブラウザ本番実行
 * （onnxruntime-web）でも同じ不具合が起きるかどうかはこのサンドボックス環境では検証できて
 * いない（本番コード`src/utils/onnxVision/main.ts`側には、未確認の不具合に対する
 * 推測的な回避策を書き込まないという方針上、そちらへは適用していない）。
 * このテストをNode.js上で実際に動かすためだけに、ここで`.onnx_data`を直接HTTPで
 * 取得して配置しておく。もしブラウザでも同じ症状（"cannot get file size ... onnx_data"）が
 * 出るようであれば、本番コード側に同様の事前フェッチが必要になる
 */
async function ensureOnnxExternalDataIsFetched(): Promise<void> {
  const cacheDir = join(tmpdir(), 'kumihimo-onnxvision-test-cache');
  mkdirSync(cacheDir, { recursive: true });
  env.cacheDir = `${cacheDir}/`;

  const onnxDir = join(cacheDir, MODEL_ID, 'onnx');
  mkdirSync(onnxDir, { recursive: true });

  const modules = ['embed_tokens', 'vision_encoder', 'decoder_model_merged'];
  for (const module of modules) {
    const fileName = `${module}_${DTYPE_SUFFIX}.onnx_data`;
    const destPath = join(onnxDir, fileName);
    if (existsSync(destPath) && statSync(destPath).size > 0) continue;

    const url = `https://huggingface.co/${MODEL_ID}/resolve/main/onnx/${fileName}`;
    // 最大300MB超のファイルを扱うため、一時的な接続断（ECONNRESET等）に備えて数回まで
    // 再試行する
    let lastError: unknown;
    let succeeded = false;
    for (let attempt = 1; attempt <= 3 && !succeeded; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`failed to pre-fetch ${url}: ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        writeFileSync(destPath, buf);
        succeeded = true;
      } catch (e) {
        lastError = e;
      }
    }
    if (!succeeded) throw lastError;
  }
}

/** GLM-OCR-ONNXの出力の桁区切り空白癖・LaTeX数式記号を取り除き、比較しやすい形にする */
function normalizeMathOutput(raw: string): string {
  let s = raw;
  // 桁の間に空白が入る癖（例: "1 2" → "12"）を、数字どうしの間の空白を繰り返し除去して解消する
  while (/\d \d/.test(s)) {
    s = s.replace(/(\d) (\d)/g, '$1$2');
  }
  return s.replace(/\$/g, '').replace(/\s+/g, '');
}

function assetPath(fileName: string): string {
  return join(VISION_ASSETS_DIR, fileName);
}

describe('runVisionTask (GLM-OCR-ONNX による数式読み取りの実機検証)', () => {
  // モデルの初回ダウンロード・ロードに時間がかかるため、最初の呼び出しで長めのタイムアウトを取る
  beforeAll(async () => {
    await ensureOnnxExternalDataIsFetched();
    await runVisionTask(assetPath('singleEquation.png'), MODEL_ID, 'Text Recognition:');
  }, 300_000);

  test(
    '単一の数式（複数桁を含む）を正しく読み取れる',
    async () => {
      const raw = await runVisionTask(assetPath('singleEquation.png'), MODEL_ID, 'Text Recognition:');
      const normalized = normalizeMathOutput(raw);
      expect(normalized).toContain('12+25=37');
    },
    60_000,
  );

  test(
    '式番号タグ付き・複数行の数式をそれぞれ正しく読み取れる',
    async () => {
      const raw = await runVisionTask(assetPath('twoEquations.png'), MODEL_ID, 'Text Recognition:');
      const normalized = normalizeMathOutput(raw);
      expect(normalized).toContain('12+4=16');
      expect(normalized).toContain('18+3=20');
    },
    60_000,
  );

  test(
    '"Formula Recognition:"タスクでも同じ内容を読み取れる（タスク文字列の差し替えだけで機能する汎用実装であることの確認）',
    async () => {
      const raw = await runVisionTask(assetPath('singleEquation.png'), MODEL_ID, 'Formula Recognition:');
      const normalized = normalizeMathOutput(raw);
      expect(normalized).toContain('12+25=37');
    },
    60_000,
  );
});
