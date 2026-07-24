/**
 * WASMプラグインの実行エンジン
 *
 * 特定の言語ランタイム（AssemblyScript等）には依存しない、言語非依存の呼び出し規約を採用する。
 * WASMの数値型（i32/i64/f32/f64）では文字列を直接やり取りできないため、文字列は次の規約で
 * 相互変換する:
 *
 * - 文字列はすべて「NUL終端のUTF-8バイト列」として、WASMモジュール自身のリニアメモリ上に
 *   置かれる。関数の引数・返り値では、その先頭バイトへのポインタ（i32）としてやり取りする
 * - ホストがWASM側へ文字列を渡す必要がある場合（エントリポイントの文字列引数、および
 *   ホストAPI呼び出しの文字列返り値）は、モジュールが公開する`alloc(size: i32) -> i32`を
 *   呼び出して書き込み先を確保する
 * - モジュールは`memory`（線形メモリ）と`alloc`をエクスポートする必要がある
 *   （`memory`はほとんどのツールチェインで既定でエクスポートされる）
 *
 * この規約はNUL終端UTF-8ポインタというC言語ABI相当の単純な取り決めのみに依拠しており、
 * Rust（`extern "C"`関数＋`#[link(wasm_import_module = "host_system")]`）はもちろん、
 * C/Zig等、WASMへコンパイルできる大半の言語で実装できる。`hostApiBridge.ts`側はこれまで通り
 * 普通のJSの値（文字列・数値・真偽値）だけを扱えばよく、このファイルがWASM境界での
 * ポインタ⇔JS値の変換を一手に引き受ける
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
import { HOST_API_REGISTRY } from 'src/services/plugin/hostApiRegistry';

/** WASMモジュールが公開しなければならないエクスポート（文字列マーシャリングに使う） */
interface WasmExports {
  memory: WebAssembly.Memory;
  alloc?: (size: number) => number;
  [key: string]: unknown;
}

type ParamKind = 'string' | 'number' | 'boolean';
interface ApiSignature {
  params: ParamKind[];
  returns: 'string' | 'number' | 'void';
}

/**
 * ホストが実際に注入するインポートオブジェクトの形は、常に`hostApiRegistry.ts`の
 * `HOST_API_REGISTRY`（唯一の情報源）から導出する。Rust SDK（`PLUGIN_SDK/rust/host_sdk.rs`）
 * の`extern "C"`ブロックも同じレジストリから生成されるため、この2つがズレることはない
 * （`src/services/plugin/__test__/hostApiCodegen.test.ts`が保証する）
 */
function signaturesForGroup(group: 'discovery' | 'execution'): Record<string, ApiSignature> {
  const result: Record<string, ApiSignature> = {};
  for (const spec of HOST_API_REGISTRY) {
    if (spec.group !== group) continue;
    result[spec.hostFnName] = {
      params: spec.params.map((param) => param.jsType),
      returns: spec.returns,
    };
  }
  return result;
}

const DISCOVERY_SIGNATURES: Record<string, ApiSignature> = signaturesForGroup('discovery');

const EXECUTION_SIGNATURES: Record<string, ApiSignature> = signaturesForGroup('execution');

interface ExportsRef {
  current: WasmExports | undefined;
}

/**
 * WASMのリニアメモリから、ptr位置のNUL終端UTF-8文字列を読み取る
 *
 * モジュールのランタイムに関係なく、生のバイト列を直接読むだけなので言語非依存
 */
function readCString(exports: WasmExports, ptr: number): string {
  if (ptr === 0) return '';
  const bytes = new Uint8Array(exports.memory.buffer, ptr);
  let len = 0;
  while (bytes[len] !== 0) len++;
  return new TextDecoder('utf-8').decode(bytes.subarray(0, len));
}

/**
 * JS文字列をWASMのリニアメモリへNUL終端UTF-8として書き込み、先頭ポインタを返す
 *
 * モジュールが公開する`alloc`を呼び出して書き込み先を確保する。`alloc`が線形メモリを
 * 拡張（`memory.grow`）した場合、既存の`ArrayBuffer`参照は無効化される（デタッチされる）
 * ため、`alloc`呼び出し**後**に必ず`memory.buffer`を取り直してから書き込むこと
 */
function writeCString(exports: WasmExports, str: string): number {
  if (typeof exports.alloc !== 'function') {
    throw new Error(
      'このプラグインは文字列を受け渡すための alloc(size: i32) -> i32 エクスポートを持っていません',
    );
  }
  const encoded = new TextEncoder().encode(str);
  const ptr = exports.alloc(encoded.length + 1);
  const view = new Uint8Array(exports.memory.buffer, ptr, encoded.length + 1);
  view.set(encoded);
  view[encoded.length] = 0;
  return ptr;
}

/**
 * ホスト関数の呼び出し規約（文字列はNUL終端UTF-8ポインタとしてやり取りする）を吸収する
 *
 * すべてのホストAPI呼び出しがここを経由するため、開発時のデバッグ用に呼び出しごとの
 * 引数・戻り値をコンソールへ出力する（プラグイン開発者が実機での不具合を調査する手段が
 * これまで無かったため）
 */
function wrapHostFn(
  exportsRef: ExportsRef,
  hostKey: string,
  sig: ApiSignature,
  fn: (...args: unknown[]) => unknown,
) {
  return (...rawArgs: number[]): number | undefined => {
    const exports = exportsRef.current;
    if (!exports) throw new Error('WASM exports are not ready yet');

    const args = sig.params.map((kind, i) => {
      const raw = rawArgs[i];
      if (kind === 'string') return readCString(exports, raw ?? 0);
      if (kind === 'boolean') return raw !== 0;
      return raw;
    });

    const result = fn(...args);
    console.debug('[plugin-host]', hostKey, args, '->', result);

    if (sig.returns === 'string') {
      return writeCString(exports, typeof result === 'string' ? result : '');
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
): WebAssembly.Imports {
  const hostSystem: Record<string, (...args: number[]) => number | undefined> = {};
  for (const [key, sig] of Object.entries(allSignatures)) {
    const fn = bridge[key];
    hostSystem[key] = fn ? wrapHostFn(exportsRef, key, sig, fn) : noopHostFn(sig);
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
    const { instance } = await WebAssembly.instantiate(binary, importObject);
    const exports = instance.exports as unknown as WasmExports;
    exportsRef.current = exports;

    const describeFn = exports[DESCRIBE_EXPORT_NAME];
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
    const { instance } = await WebAssembly.instantiate(binary, importObject);
    const exports = instance.exports as unknown as WasmExports;
    exportsRef.current = exports;

    const entryFn = exports[entryId];
    if (typeof entryFn !== 'function') {
      return Failure(new Error(`Entry point export not found in plugin binary: ${entryId}`));
    }

    const wasmArgs = positionalArgs.map((arg) => {
      if (typeof arg === 'string') return writeCString(exports, arg);
      if (typeof arg === 'boolean') return arg ? 1 : 0;
      return arg;
    });

    const result = (entryFn as (...args: number[]) => number)(...wasmArgs);
    return Success(result);
  } catch (e) {
    return Failure(toError(e));
  }
}
