/**
 * プラグイン申請フローの【モック】実装
 *
 * 実際のGitHub PR + CI/CDは存在しないため、「送信→保留→CI検証結果→公開」という状態遷移を
 * アプリ内でタイマーにより模擬する。将来、プラグインストア・リポジトリ
 * （`samplePlugins/pluginStoreRepoTemplate/`参照。あちらは実際に動くCI設定である点に注意）が
 * 実在すれば、ここをそのリポジトリのPR/Checks状態を読みに行く実装へ置き換える想定
 */
import { v4 as uuidv4 } from 'uuid';
import type { PluginManifest } from 'src/models/plugin/manifest';
import { type PluginSubmission, PluginSubmissionID } from 'src/models/plugin/submission';
import type { Result } from 'src/models/error/result';
import { Failure, Success } from 'src/models/error/result';
import * as pluginDb from 'src/repositories/db/plugin';
import { parseManifest } from 'src/services/plugin/manifest';

const MOCK_CI_DELAY_MS = 3000;
const WASM_MAGIC_NUMBER = [0x00, 0x61, 0x73, 0x6d];

function hasValidWasmMagicNumber(binary: Uint8Array): boolean {
  if (binary.length < 4) return false;
  return WASM_MAGIC_NUMBER.every((byte, i) => binary[i] === byte);
}

/**
 * モックCI検証を実行し、一定時間後に合否をシミュレートして申請の状態を更新する
 */
async function runMockCi(
  id: PluginSubmissionID,
  manifest: PluginManifest,
  binary: Uint8Array,
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, MOCK_CI_DELAY_MS));

  const manifestOk = parseManifest(manifest).ok;
  const wasmOk = manifest.runtime !== 'wasm' || hasValidWasmMagicNumber(binary);
  const passed = manifestOk && wasmOk;

  const current = await pluginDb.getSubmission(id);
  if (!current.ok) return;

  const ciLog = [
    `manifest検証: ${manifestOk ? 'OK' : 'NG'}`,
    `WASMバイナリ検証: ${wasmOk ? 'OK' : 'NG'}`,
    '（モックCIです。実際のGitHub Actionsは実行されていません）',
  ].join('\n');

  await pluginDb.putSubmission({
    ...current.value,
    status: passed ? 'ci_passed' : 'ci_failed',
    ciLog,
    updatedAt: new Date(),
  });
}

export async function submitPlugin(
  manifest: PluginManifest,
  binary: Uint8Array,
): Promise<Result<PluginSubmission>> {
  const now = new Date();
  const submission: PluginSubmission = {
    id: PluginSubmissionID.parse(uuidv4()),
    manifest,
    status: 'pending',
    submittedAt: now,
    updatedAt: now,
  };

  const saveRes = await pluginDb.putSubmission(submission);
  if (!saveRes.ok) return saveRes;

  void runMockCi(submission.id, manifest, binary);

  return Success(submission);
}

export function getSubmissions(): Promise<Result<PluginSubmission[]>> {
  return pluginDb.getSubmissions();
}

export async function republishSubmission(id: PluginSubmissionID): Promise<Result<void>> {
  const current = await pluginDb.getSubmission(id);
  if (!current.ok) return current;
  if (current.value.status !== 'ci_passed') {
    return Failure(new Error('CI検証に合格していない申請は公開できません'));
  }

  return pluginDb.putSubmission({ ...current.value, status: 'published', updatedAt: new Date() });
}

export async function reuploadSubmission(
  id: PluginSubmissionID,
  manifest: PluginManifest,
  binary: Uint8Array,
): Promise<Result<PluginSubmission>> {
  const current = await pluginDb.getSubmission(id);
  if (!current.ok) return current;

  const updated: PluginSubmission = {
    ...current.value,
    manifest,
    status: 'pending',
    updatedAt: new Date(),
  };
  const saveRes = await pluginDb.putSubmission(updated);
  if (!saveRes.ok) return saveRes;

  void runMockCi(id, manifest, binary);

  return Success(updated);
}
