/**
 * 任意のONNXビジョン言語モデルを、指定したcanvas画像に対して実行するための汎用ユーティリティ
 *
 * 特定のモデル（数式検証プラグインが使う"onnx-community/GLM-OCR-ONNX"等）に依存しない、
 * transformers.jsの`AutoProcessor`/`AutoModelForImageTextToText`をそのまま薄くラップした層。
 * `modelId`（Hugging Face Hub上のtransformers.js対応モデルのリポジトリID）と`task`
 * （そのモデルへ渡すプロンプト/タスク指示文字列）を呼び出し側が自由に指定できるため、
 * 将来的に他のONNXビジョン言語モデルを使いたいプラグインもこの関数をそのまま利用できる
 *
 * 実行プロバイダはWeb-GPUが使える環境では'webgpu'、それ以外では'wasm'にフォールバックする
 * （`resolveDevice`）。モデル・プロセッサはURL（`modelId`）ごとにキャッシュし、複数ページ・
 * 複数回の呼び出しで毎回読み込み直さないようにする
 */
import {
  AutoProcessor,
  AutoModelForImageTextToText,
  load_image,
} from '@huggingface/transformers';

interface LoadedVisionModel {
  processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
  model: Awaited<ReturnType<typeof AutoModelForImageTextToText.from_pretrained>>;
}

// modelIdごとにロード済みモデルをキャッシュする（読み込みには数百MB単位のダウンロードを
// 伴うため、ページ・呼び出しをまたいで使い回す）。失敗した場合は次回呼び出しで再試行できるよう
// キャッシュから取り除く
const loadedModels = new Map<string, Promise<LoadedVisionModel>>();

/**
 * 実行環境に応じて最適な実行プロバイダを選ぶ
 *
 * ブラウザではWeb-GPUが使える場合は'webgpu'、使えない場合は'wasm'にフォールバックする。
 * Node.js/bun環境（`bun test`等）では'wasm'は無効な値としてtransformers.js側が例外を
 * 投げるため'cpu'を使う（`onnx-community/GLM-OCR-ONNX`での実機検証時に確認した挙動）。
 * ブラウザかどうかの判定にはjsdom等でポリフィルされうる`window`ではなく、
 * Node.js固有の`process.versions.node`の有無を使う
 */
function resolveDevice(): 'webgpu' | 'wasm' | 'cpu' {
  const isNodeLike = typeof process !== 'undefined' && process.versions?.node != null;
  if (isNodeLike) return 'cpu';
  const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu != null;
  return hasWebGpu ? 'webgpu' : 'wasm';
}

async function getModel(modelId: string): Promise<LoadedVisionModel> {
  let promise = loadedModels.get(modelId);
  if (!promise) {
    promise = (async () => {
      const processor = await AutoProcessor.from_pretrained(modelId);
      const model = await AutoModelForImageTextToText.from_pretrained(modelId, {
        device: resolveDevice(),
        dtype: 'q4f16',
      });
      return { processor, model };
    })().catch((e: unknown) => {
      loadedModels.delete(modelId);
      throw e;
    });
    loadedModels.set(modelId, promise);
  }
  return promise;
}

/**
 * 指定した画像に対し、ONNXビジョン言語モデル（`modelId`）へ`task`をプロンプトとして
 * 渡して推論し、生成されたテキストを返す
 *
 * `image`はcanvas（ページ画像のレンダリング結果）を直接渡す。`data:`URL文字列へ変換して
 * 渡す方式は使わない（`load_image`の内部実装がURLのスキームを`http:`/`https:`/`blob:`
 * のみ有効と判定するため、`data:`URLは正しく読み込めない）。canvasを直接渡す形であれば
 * `load_image`が`RawImage.fromCanvas`へ委譲し、余計なPNGエンコード/デコードの往復も避けられる。
 * テスト等でURL/ファイルパス文字列から直接読み込みたい場合のために`string`も受け付ける
 *
 * `task`はモデルごとに定められたタスク指示文字列（例:
 * "onnx-community/GLM-OCR-ONNX"の場合は"Text Recognition:"/"Formula Recognition:"/
 * "Table Recognition:"のいずれか）で、host側では一切解釈せずそのままモデルへ渡す
 */
export async function runVisionTask(
  image: HTMLCanvasElement | string,
  modelId: string,
  task: string,
): Promise<string> {
  const { processor, model } = await getModel(modelId);

  const messages = [
    { role: 'user', content: [{ type: 'image' }, { type: 'text', text: task }] },
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prompt = (processor as any).apply_chat_template(messages, { add_generation_prompt: true });

  const loadedImage = await load_image(image);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inputs = await (processor as any)(prompt, loadedImage, { add_special_tokens: false });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const outputs = await (model as any).generate({ ...inputs, max_new_tokens: 1024 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const decoded: string[] = (processor as any).batch_decode(
    outputs.slice(null, [inputs.input_ids.dims.at(-1), null]),
    { skip_special_tokens: true },
  );
  return decoded[0] ?? '';
}
