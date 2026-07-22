/**
 * プラグインのインストール・アンインストール・一覧取得を扱う
 */
import type { Result } from 'src/models/error/result';
import { Failure, Success } from 'src/models/error/result';
import type { PluginManifest, PluginID } from 'src/models/plugin/manifest';
import type { InstalledPlugin, CatalogEntry } from 'src/models/plugin/installation';
import * as pluginDb from 'src/repositories/db/plugin';
import * as binaryStore from 'src/repositories/plugin/binaryStore';
import * as catalog from 'src/repositories/plugin/catalog';
import { uint8ArrayToBase64 } from 'src/utils/binary/base64';

export function getInstalledPlugins(): Promise<Result<InstalledPlugin[]>> {
  return pluginDb.getInstalledPlugins();
}

export function getCatalogEntries(githubToken?: string): Promise<Result<CatalogEntry[]>> {
  return catalog.getCatalogEntries(githubToken);
}

/** 画像の先頭バイトからMIMEタイプを推定する（申請時のCI検証で画像形式である前提のため簡易判定でよい） */
function sniffImageMimeType(bytes: Uint8Array): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'image/gif';
  }
  return 'image/png';
}

function toIconDataUrl(bytes: Uint8Array): Result<string> {
  const b64 = uint8ArrayToBase64(bytes);
  if (!b64.ok) return b64;
  return Success(`data:${sniffImageMimeType(bytes)};base64,${b64.value}`);
}

export async function installPlugin(
  manifest: PluginManifest,
  binary: Uint8Array,
  icon?: Uint8Array,
): Promise<Result<void>> {
  const binRes = await binaryStore.setBinary(manifest.id, binary);
  if (!binRes.ok) return binRes;

  let iconDataUrl: string | undefined;
  if (icon) {
    const iconRes = toIconDataUrl(icon);
    if (iconRes.ok) iconDataUrl = iconRes.value;
  }

  const entry: InstalledPlugin = { manifest, installedAt: new Date(), enabled: true, iconDataUrl };
  return pluginDb.putInstalledPlugin(entry);
}

/**
 * カタログ上のプラグインをそのままインストールする（本体・アイコンはストアリポジトリから取得）
 */
export async function installFromCatalog(
  id: PluginID,
  githubToken?: string,
): Promise<Result<void>> {
  const entriesRes = await catalog.getCatalogEntries(githubToken);
  if (!entriesRes.ok) return entriesRes;
  const entry = entriesRes.value.find((e) => e.manifest.id === id);
  if (!entry) return Failure(new Error(`Not Found Catalog Entry (id: ${id})`));

  const binRes = await catalog.getCatalogBinary(entry.manifest, githubToken);
  if (!binRes.ok) return binRes;

  let icon: Uint8Array | undefined;
  if (entry.manifest.iconFile) {
    const iconRes = await catalog.getCatalogIcon(entry.manifest);
    if (iconRes.ok) icon = iconRes.value;
  }

  return installPlugin(entry.manifest, binRes.value, icon);
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
