/**
 * プラグインの発見・実行、および実行結果（plan）の承認/却下によるコミットを統括する
 */
import { v4 as uuidv4 } from 'uuid';
import type { Observable } from 'dexie';
import type { ContainerElementFile } from 'src/models/container';
import type { PluginID, PluginRuntime, PluginManifest } from 'src/models/plugin/manifest';
import type { PluginEntryPointDescriptor } from 'src/models/plugin/discovery';
import type { PluginRunState } from 'src/models/plugin/panel';
import type { Result } from 'src/models/error/result';
import { Failure, Success } from 'src/models/error/result';
import * as pluginDb from 'src/repositories/db/plugin';
import * as annotationService from 'src/services/document/annotation';
import * as relationalService from 'src/services/document/relational';
import * as wasmEngine from 'src/services/plugin/engines/wasmEngine';
import * as pyodideEngine from 'src/services/plugin/engines/pyodideEngine';
import { buildExecutionContext } from 'src/services/plugin/hostContext';
import type { ExecutionState } from 'src/services/plugin/hostApiBridge';
import { getPluginBinary } from 'src/services/plugin/install';

/**
 * 実行エンジン種別ごとの処理振り分け（`services/container/main.ts`の
 * `switchContainerProcess`と同型のディスパッチ）
 */
async function switchEngineProcess<T>(
  runtime: PluginRuntime,
  wasmProcess: () => Promise<T>,
  pyodideProcess: () => Promise<T>,
): Promise<T> {
  switch (runtime) {
    case 'wasm':
      return await wasmProcess();
    case 'pyodide':
      return await pyodideProcess();
  }
}

async function loadInstalledPlugin(
  id: PluginID,
): Promise<Result<{ manifest: PluginManifest; binary: Uint8Array }>> {
  const entryRes = await pluginDb.getInstalledPlugin(id);
  if (!entryRes.ok) return entryRes;
  const binRes = await getPluginBinary(id);
  if (!binRes.ok) return binRes;
  return Success({ manifest: entryRes.value.manifest, binary: binRes.value });
}

/**
 * プラグインが自己申告するエントリポイント・入力項目を発見する
 */
export async function discoverEntryPoints(
  id: PluginID,
): Promise<Result<PluginEntryPointDescriptor[]>> {
  const loaded = await loadInstalledPlugin(id);
  if (!loaded.ok) return loaded;
  const { manifest, binary } = loaded.value;

  return switchEngineProcess(
    manifest.runtime,
    () => wasmEngine.discoverEntryPoints(binary),
    () => pyodideEngine.discoverEntryPoints(binary),
  );
}

/**
 * プラグインのエントリポイントを実行する
 *
 * `fieldValues`はdiscover結果のfieldIdをキーとする値。未指定のフィールドは
 * discover結果のdefaultValueで補う
 */
export async function runEntryPoint(
  id: PluginID,
  entryId: string,
  fieldValues: Record<string, string | number | boolean>,
  targetFile: ContainerElementFile,
): Promise<Result<PluginRunState>> {
  const loaded = await loadInstalledPlugin(id);
  if (!loaded.ok) return loaded;
  const { manifest, binary } = loaded.value;

  const descriptorsRes = await discoverEntryPoints(id);
  if (!descriptorsRes.ok) return descriptorsRes;
  const descriptor = descriptorsRes.value.find((d) => d.entryId === entryId);
  if (!descriptor) return Failure(new Error(`Not Found Entry Point (entryId: ${entryId})`));

  const ctxRes = await buildExecutionContext(manifest, targetFile);
  if (!ctxRes.ok) return ctxRes;
  const ctx = ctxRes.value;

  // 引数順: [システムコンテキスト] pageCount, pageWidth, pageHeight → [discover宣言順] ユーザー入力値
  const positionalArgs: Array<string | number | boolean> = [
    ctx.pageCount,
    ctx.representativePageSize.width,
    ctx.representativePageSize.height,
    ...descriptor.fields.map((field) => fieldValues[field.fieldId] ?? field.defaultValue),
  ];

  const state: ExecutionState = { blocks: [], plan: [], confirmationMode: 'perItem' };

  const execRes = await switchEngineProcess(
    manifest.runtime,
    () => wasmEngine.runEntryPoint(binary, entryId, positionalArgs, manifest, ctx, state),
    () => pyodideEngine.runEntryPoint(binary, entryId, positionalArgs),
  );

  if (!execRes.ok) {
    state.blocks.push({ kind: 'text', text: `実行エラー: ${execRes.error.message}` });
  }

  const runState: PluginRunState = {
    runId: uuidv4(),
    pluginId: id,
    entryId,
    targetFile,
    blocks: state.blocks,
    plan: state.plan,
    status: execRes.ok ? 'done' : 'error',
  };

  const saveRes = await pluginDb.putRunState(runState);
  if (!saveRes.ok) return saveRes;

  return Success(runState);
}

export function getRunState(runId: string): Promise<Result<PluginRunState>> {
  return pluginDb.getRunState(runId);
}

export function observeRunState(runId: string): Observable<PluginRunState | undefined> {
  return pluginDb.observeRunState(runId);
}

/**
 * 承認された書き込み予定項目を実データへコミットする
 */
export async function approvePlanItems(runId: string, itemIds: string[]): Promise<Result<void>> {
  const stateRes = await pluginDb.getRunState(runId);
  if (!stateRes.ok) return stateRes;
  const runState = stateRes.value;

  for (const item of runState.plan) {
    if (!itemIds.includes(item.id) || item.status !== 'planned') continue;

    // 安全確認: 変更・削除対象が実行対象ファイルに属することを検証してからコミットする
    // （プラグインが無関係のファイルの注釈IDを指定してしまった場合の安全策）
    if (item.kind === 'annotationUpdate' || item.kind === 'annotationRemove') {
      const addressRes = await annotationService.getAnnotationAddress(item.annotId);
      const matchesTarget =
        addressRes.ok &&
        addressRes.value.cID === item.file.containerID &&
        addressRes.value.filePath === item.file.path;
      if (!matchesTarget) {
        item.status = 'rejected';
        continue;
      }
    }

    let commitRes: Result<unknown>;
    switch (item.kind) {
      case 'annotationCreate':
      case 'annotationUpdate':
        commitRes = await annotationService.registerAnnotationStyle(
          runState.targetFile,
          item.style,
        );
        break;
      case 'annotationRemove': {
        const removeRes = await annotationService.removeAnnotationInfo(item.annotId);
        if (removeRes.ok) {
          await relationalService.removeRelationalsForAnnotation(item.annotId);
        }
        commitRes = removeRes;
        break;
      }
      case 'relationalCreate':
        commitRes = await relationalService.registRelational(item.relational);
        break;
      case 'relationalRemove':
        commitRes = await relationalService.removeRelationalEdge(item.srcId, item.targetId);
        break;
    }
    item.status = commitRes.ok ? 'committed' : 'rejected';
  }

  return pluginDb.putRunState(runState);
}

/**
 * 却下された書き込み予定項目を確定させる（実データへの反映はしない）
 */
export async function rejectPlanItems(runId: string, itemIds: string[]): Promise<Result<void>> {
  const stateRes = await pluginDb.getRunState(runId);
  if (!stateRes.ok) return stateRes;
  const runState = stateRes.value;

  for (const item of runState.plan) {
    if (itemIds.includes(item.id) && item.status === 'planned') {
      item.status = 'rejected';
    }
  }

  return pluginDb.putRunState(runState);
}
