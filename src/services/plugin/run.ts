/**
 * プラグインの発見・実行、および実行結果（plan）の承認/却下によるコミットを統括する
 */
import { v4 as uuidv4 } from 'uuid';
import type { Observable } from 'dexie';
import { ContainerElementFile } from 'src/models/container';
import type { PluginID, PluginRuntime, PluginManifest } from 'src/models/plugin/manifest';
import type { PluginInstallSource } from 'src/models/plugin/installation';
import type { PluginEntryPointDescriptor } from 'src/models/plugin/discovery';
import type { PluginRunState } from 'src/models/plugin/panel';
import type { Result } from 'src/models/error/result';
import { Failure, Success, toError } from 'src/models/error/result';
import * as pluginDb from 'src/repositories/db/plugin';
import * as annotationService from 'src/services/document/annotation';
import * as relationalService from 'src/services/document/relational';
import * as wasmEngine from 'src/services/plugin/engines/wasmEngine';
import * as pyodideEngine from 'src/services/plugin/engines/pyodideEngine';
import { buildExecutionContext } from 'src/services/plugin/hostContext';
import type { ExecutionState } from 'src/services/plugin/hostApiBridge';
import { getPluginBinary } from 'src/services/plugin/install';
import { buildPositionalArgs } from 'src/services/plugin/positionalArgs';

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
  source: PluginInstallSource,
): Promise<Result<{ manifest: PluginManifest; binary: Uint8Array }>> {
  const entryRes = await pluginDb.getInstalledPlugin(id, source);
  if (!entryRes.ok) return entryRes;
  const binRes = await getPluginBinary(id, source);
  if (!binRes.ok) return binRes;
  return Success({ manifest: entryRes.value.manifest, binary: binRes.value });
}

/**
 * プラグインが自己申告するエントリポイント・入力項目を発見する
 */
export async function discoverEntryPoints(
  id: PluginID,
  source: PluginInstallSource,
): Promise<Result<PluginEntryPointDescriptor[]>> {
  const loaded = await loadInstalledPlugin(id, source);
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
 * `fieldValues`はdiscover結果のfieldIdをキーとする値（`file`型フィールドの値は含まない。
 * ファイル選択の解決結果は`targetFiles`として別途渡す）。未指定のフィールドは
 * discover結果のdefaultValueで補う
 *
 * `targetFiles`はVueコンポーネント（`reactive`な状態）から渡ってくるため、Vueのreactive
 * Proxyをそのまま保持している場合がある。Proxyのままだと`pluginDb.putRunState`内の
 * `structuredClone`がクローンできずDataCloneErrorになるため、Zodで再パースしてプレーンな
 * オブジェクトへ正規化してから使う（Proxy越しの値読み出しにより自然にコピーされる）
 */
export async function runEntryPoint(
  id: PluginID,
  source: PluginInstallSource,
  entryId: string,
  fieldValues: Record<string, string | number | boolean>,
  rawTargetFiles: ContainerElementFile[],
): Promise<Result<PluginRunState>> {
  const targetFilesRes = ContainerElementFile.array().safeParse(rawTargetFiles);
  if (!targetFilesRes.success) return Failure(toError(targetFilesRes.error));
  const targetFiles = targetFilesRes.data;

  const loaded = await loadInstalledPlugin(id, source);
  if (!loaded.ok) return loaded;
  const { manifest, binary } = loaded.value;

  const descriptorsRes = await discoverEntryPoints(id, source);
  if (!descriptorsRes.ok) return descriptorsRes;
  const descriptor = descriptorsRes.value.find((d) => d.entryId === entryId);
  if (!descriptor) return Failure(new Error(`Not Found Entry Point (entryId: ${entryId})`));

  // `ai.getVisionTaskResult`はdescribePlugin実行時に`ai.declareVisionTask`で宣言された内容
  // （どのモデル・どのタスクで事前推論するか）に基づいて事前解決するため、descriptorを
  // buildExecutionContextより前に確定させ、その`visionTasks`を渡す
  const ctxRes = await buildExecutionContext(manifest, targetFiles, descriptor.visionTasks);
  if (!ctxRes.ok) return ctxRes;
  const ctx = ctxRes.value;

  const positionalArgs = buildPositionalArgs(descriptor, fieldValues, ctx);

  const state: ExecutionState = { blocks: [], plan: [], confirmationMode: 'perItem' };

  const execRes = await switchEngineProcess(
    manifest.runtime,
    () => wasmEngine.runEntryPoint(binary, entryId, positionalArgs, manifest, ctx, state),
    () => pyodideEngine.runEntryPoint(binary, entryId, positionalArgs),
  );

  if (!execRes.ok) {
    console.error('[plugin] execution failed:', id, entryId, execRes.error);
    state.blocks.push({
      kind: 'text',
      text: `実行エラー: ${execRes.error.message}`,
      severity: 'error',
    });
  }

  const runState: PluginRunState = {
    runId: uuidv4(),
    pluginId: id,
    entryId,
    targetFiles,
    blocks: state.blocks,
    plan: state.plan,
    // execRes.okでもプラグイン自身がui.reportErrorで失敗を報告した場合はエラー扱いにする
    status: execRes.ok && !state.hasPluginReportedError ? 'done' : 'error',
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

    // 安全確認: 作成・変更・削除対象がこのランのtargetFilesに属することを検証してから
    // コミットする（プラグインが無関係のファイルの注釈IDを指定してしまった場合の安全策）
    if (item.kind === 'annotationCreate') {
      const belongsToRun = runState.targetFiles.some(
        (f) => f.containerID === item.file.containerID && f.path === item.file.path,
      );
      if (!belongsToRun) {
        item.status = 'rejected';
        continue;
      }
    }
    if (item.kind === 'annotationUpdate' || item.kind === 'annotationRemove') {
      const addressRes = await annotationService.getAnnotationAddress(item.annotId);
      const matchesTarget =
        addressRes.ok &&
        runState.targetFiles.some(
          (f) => f.containerID === addressRes.value.cID && f.path === addressRes.value.filePath,
        );
      if (!matchesTarget) {
        item.status = 'rejected';
        continue;
      }
    }

    let commitRes: Result<unknown>;
    switch (item.kind) {
      case 'annotationCreate':
      case 'annotationUpdate': {
        // 直前の安全確認により本来は必ず見つかるが、型上フォールバックを用意する
        const targetFile = runState.targetFiles.find(
          (f) => f.containerID === item.file.containerID && f.path === item.file.path,
        );
        if (!targetFile) {
          item.status = 'rejected';
          continue;
        }
        commitRes = await annotationService.registerAnnotationStyle(targetFile, item.style);
        break;
      }
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
