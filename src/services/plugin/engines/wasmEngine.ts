/**
 * WASM（AssemblyScriptビルド）プラグインの実行エンジン
 *
 * AssemblyScriptの文字列（UTF-16・GC管理）とJSの文字列を相互変換するため、
 * `@assemblyscript/loader`（`--exportRuntime`が出力するメモリ管理エクスポートを利用する
 * 公式ヘルパー）経由でインスタンス化する。ホスト関数（プラグインから呼ばれる側）が受け取る
 * 引数・返す値は、WASM側では文字列も含めすべて数値（ポインタ）としてやり取りされるため、
 * このファイルが`__getString`/`__newString`を使った変換を一手に引き受け、
 * `hostApiBridge.ts`側は普通のJSの値だけを扱えばよいようにしている
 *
 * 既知の制約: この変換方式はAssemblyScriptのランタイム規約に依拠しており、Rust/wasm-bindgen等
 * 別のABIを使うプラグインでは同じ方法は使えない（次イテレーションで別途対応）
 *
 * また、`describePlugin`と実行対象のエントリポイントが同一のWASMモジュール内にある場合、
 * WASMの仕様上インスタンス化時にモジュールが宣言する全インポートを満たす必要があるため、
 * 発見（discover）専用の呼び出しであっても実行時APIのダミー実装を用意する。そのため
 * 「発見パスで実行時APIを誤って呼び出した場合に即座にリンクエラーになる」という保証は
 * 機構的には持たない（開発者ガイドで規約として明記する）
 */
import type { Result } from 'src/models/error/result';
import { Failure, Success, toError } from 'src/models/error/result';
import type { PluginEntryPointDescriptor } from 'src/models/plugin/discovery';
import type { PluginManifest } from 'src/models/plugin/manifest';
import type { PluginExecutionContext } from 'src/services/plugin/hostContext';
import {
  buildDiscoveryBridge,
  buildExecutionBridge,
  type DiscoveryState,
  type ExecutionState,
} from 'src/services/plugin/hostApiBridge';

import { instantiate as instantiateAsModule, type Imports } from '@assemblyscript/loader';

interface AsExports {
  __getString(ptr: number): string;
  __newString(str: string): number;
  [key: string]: unknown;
}

type ParamKind = 'string' | 'number' | 'boolean';
interface ApiSignature {
  params: ParamKind[];
  returns: 'string' | 'number' | 'void';
}

const DISCOVERY_SIGNATURES: Record<string, ApiSignature> = {
  ui_register_entry_point: { params: ['string', 'string', 'string'], returns: 'void' },
  ui_add_text_field: { params: ['string', 'string', 'string', 'boolean'], returns: 'void' },
  ui_add_number_field: { params: ['string', 'string', 'number', 'boolean'], returns: 'void' },
  ui_add_toggle_field: { params: ['string', 'string', 'boolean'], returns: 'void' },
  ui_add_select_field: {
    params: ['string', 'string', 'string', 'string'],
    returns: 'void',
  },
};

const EXECUTION_SIGNATURES: Record<string, ApiSignature> = {
  ui_report_progress: { params: ['number'], returns: 'void' },
  plan_set_confirmation_mode: { params: ['string'], returns: 'void' },
  plan_add_annotation: {
    params: [
      'number',
      'number',
      'number',
      'number',
      'number',
      'string',
      'string',
      'number',
      'string',
    ],
    returns: 'string',
  },
  plan_update_annotation: {
    params: [
      'string',
      'number',
      'number',
      'number',
      'number',
      'string',
      'string',
      'number',
      'string',
    ],
    returns: 'string',
  },
  plan_remove_annotation: { params: ['string'], returns: 'string' },
  plan_add_relational: { params: ['string', 'string', 'string'], returns: 'string' },
  plan_remove_relational: { params: ['string', 'string'], returns: 'string' },
  doc_get_project_metadata: { params: [], returns: 'string' },
  doc_get_page_size: { params: ['number'], returns: 'string' },
  doc_get_page_text_blocks: { params: ['number'], returns: 'string' },
  doc_get_page_image: { params: ['number'], returns: 'string' },
  doc_get_annotations_by_file: { params: [], returns: 'string' },
  doc_get_annotation_ids_by_tag: { params: ['string'], returns: 'string' },
};

interface ExportsRef {
  current: AsExports | undefined;
}

/** ホスト関数の呼び出し規約（AssemblyScript側は文字列もi32ポインタとしてやり取りする）を吸収する */
function wrapHostFn(
  exportsRef: ExportsRef,
  sig: ApiSignature,
  fn: (...args: unknown[]) => unknown,
) {
  return (...rawArgs: number[]): number | undefined => {
    const exports = exportsRef.current;
    if (!exports) throw new Error('WASM exports are not ready yet');

    const args = sig.params.map((kind, i) => {
      const raw = rawArgs[i];
      if (kind === 'string') return exports.__getString(raw ?? 0);
      if (kind === 'boolean') return raw !== 0;
      return raw;
    });

    const result = fn(...args);

    if (sig.returns === 'string') {
      return exports.__newString(typeof result === 'string' ? result : '');
    }
    if (sig.returns === 'number') return result as number;
    return undefined;
  };
}

/** 未使用のホスト関数に対する無害なダミー実装（発見パスでの実行時API誤呼び出し対策） */
function noopHostFn(sig: ApiSignature) {
  return (): number | undefined => {
    if (sig.returns === 'string') return 0;
    if (sig.returns === 'number') return 0;
    return undefined;
  };
}

function buildImportObject(
  bridge: Record<string, (...args: unknown[]) => unknown>,
  allSignatures: Record<string, ApiSignature>,
  exportsRef: ExportsRef,
): Imports {
  const hostSystem: Record<string, unknown> = {};
  for (const [key, sig] of Object.entries(allSignatures)) {
    const fn = bridge[key];
    hostSystem[key] = fn ? wrapHostFn(exportsRef, sig, fn) : noopHostFn(sig);
  }
  return { host_system: hostSystem };
}

const DESCRIBE_EXPORT_NAME = 'describePlugin';

/**
 * WASMを「発見専用」に実行し、`describePlugin`が宣言したエントリポイント・入力項目を返す
 */
export async function discoverEntryPoints(
  binary: Uint8Array,
): Promise<Result<PluginEntryPointDescriptor[]>> {
  const state: DiscoveryState = { entryPoints: [] };
  const bridge = buildDiscoveryBridge(state);
  const exportsRef: ExportsRef = { current: undefined };
  const allSignatures = { ...DISCOVERY_SIGNATURES, ...EXECUTION_SIGNATURES };
  const importObject = buildImportObject(bridge, allSignatures, exportsRef);

  try {
    const instantiated = await instantiateAsModule<AsExports>(binary, importObject);
    exportsRef.current = instantiated.exports;

    const describeFn = instantiated.exports[DESCRIBE_EXPORT_NAME];
    if (typeof describeFn !== 'function') {
      return Failure(new Error(`${DESCRIBE_EXPORT_NAME} export not found in plugin binary`));
    }
    (describeFn as () => void)();
    return Success(state.entryPoints);
  } catch (e) {
    return Failure(toError(e));
  }
}

/**
 * WASMの実際のエントリポイントを実行する
 *
 * `positionalArgs`は`hostContext.ts`が組み立てたシステムコンテキスト引数＋
 * discovery結果の宣言順に並べたユーザー入力値を、この順序のまま渡すこと
 */
export async function runEntryPoint(
  binary: Uint8Array,
  entryId: string,
  positionalArgs: Array<string | number | boolean>,
  manifest: PluginManifest,
  ctx: PluginExecutionContext,
  state: ExecutionState,
): Promise<Result<unknown>> {
  const bridge = buildExecutionBridge(manifest, ctx, state);
  const exportsRef: ExportsRef = { current: undefined };
  const allSignatures = { ...DISCOVERY_SIGNATURES, ...EXECUTION_SIGNATURES };
  const importObject = buildImportObject(bridge, allSignatures, exportsRef);

  try {
    const instantiated = await instantiateAsModule<AsExports>(binary, importObject);
    const exports = instantiated.exports;
    exportsRef.current = exports;

    const entryFn = exports[entryId];
    if (typeof entryFn !== 'function') {
      return Failure(new Error(`Entry point export not found in plugin binary: ${entryId}`));
    }

    const wasmArgs = positionalArgs.map((arg) => {
      if (typeof arg === 'string') return exports.__newString(arg);
      if (typeof arg === 'boolean') return arg ? 1 : 0;
      return arg;
    });

    const result = (entryFn as (...args: number[]) => number)(...wasmArgs);
    return Success(result);
  } catch (e) {
    return Failure(toError(e));
  }
}
