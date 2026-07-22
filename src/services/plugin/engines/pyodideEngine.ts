/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Pyodide（Python）プラグインの実行エンジン
 *
 * 未実装スタブ。`src/repositories/container/box.ts`と同じ規約で、すべての関数が
 * `Not implemented`エラーを返す。実装は次イテレーションに送る
 */
import type { Result } from 'src/models/error/result';
import { Failure } from 'src/models/error/result';
import type { PluginEntryPointDescriptor } from 'src/models/plugin/discovery';

export function discoverEntryPoints(
  binary: Uint8Array,
): Promise<Result<PluginEntryPointDescriptor[]>> {
  return Promise.resolve(Failure(new Error('Not implemented (Pyodide engine)')));
}

export function runEntryPoint(
  binary: Uint8Array,
  entryId: string,
  positionalArgs: Array<string | number | boolean>,
): Promise<Result<unknown>> {
  return Promise.resolve(Failure(new Error('Not implemented (Pyodide engine)')));
}
