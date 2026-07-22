/**
 * プラグインのインストール・アンインストール・一覧取得を扱う
 */
import type { Result } from 'src/models/error/result';
import { Failure } from 'src/models/error/result';
import type { PluginManifest, PluginID } from 'src/models/plugin/manifest';
import type { InstalledPlugin, CatalogEntry } from 'src/models/plugin/installation';
import * as pluginDb from 'src/repositories/db/plugin';
import * as binaryStore from 'src/repositories/plugin/binaryStore';
import * as catalog from 'src/repositories/plugin/catalog';

export function getInstalledPlugins(): Promise<Result<InstalledPlugin[]>> {
  return pluginDb.getInstalledPlugins();
}

export function getCatalogEntries(): Promise<Result<CatalogEntry[]>> {
  return catalog.getCatalogEntries();
}

export async function installPlugin(
  manifest: PluginManifest,
  binary: Uint8Array,
): Promise<Result<void>> {
  const binRes = await binaryStore.setBinary(manifest.id, binary);
  if (!binRes.ok) return binRes;

  const entry: InstalledPlugin = { manifest, installedAt: new Date(), enabled: true };
  return pluginDb.putInstalledPlugin(entry);
}

/**
 * カタログ上のプラグインをそのままインストールする（バイナリはモックカタログ経由で取得）
 */
export async function installFromCatalog(id: PluginID): Promise<Result<void>> {
  const entriesRes = await catalog.getCatalogEntries();
  if (!entriesRes.ok) return entriesRes;
  const entry = entriesRes.value.find((e) => e.manifest.id === id);
  if (!entry) return Failure(new Error(`Not Found Catalog Entry (id: ${id})`));

  const binRes = await catalog.getCatalogBinary(id);
  if (!binRes.ok) return binRes;

  return installPlugin(entry.manifest, binRes.value);
}

export async function uninstallPlugin(id: PluginID): Promise<Result<void>> {
  const delBinRes = await binaryStore.deleteBinary(id);
  if (!delBinRes.ok) return delBinRes;
  return pluginDb.deleteInstalledPlugin(id);
}

export async function setPluginEnabled(id: PluginID, enabled: boolean): Promise<Result<void>> {
  const current = await pluginDb.getInstalledPlugin(id);
  if (!current.ok) return current;
  return pluginDb.putInstalledPlugin({ ...current.value, enabled });
}

export function getPluginBinary(id: PluginID): Promise<Result<Uint8Array>> {
  return binaryStore.getBinary(id);
}
