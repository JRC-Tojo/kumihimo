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
import { uint8ArrayToBase64 } from 'src/utils/binary/base64';
import { sniffImageFormat, mimeTypeForImageFormat } from 'src/utils/binary/imageSniff';

export function getInstalledPlugins(): Promise<Result<InstalledPlugin[]>> {
  return pluginDb.getInstalledPlugins();
}

export function getCatalogEntries(githubToken?: string): Promise<Result<CatalogEntry[]>> {
  return catalog.getCatalogEntries(githubToken);
}

/**
 * アイコン画像をdata URL化する。PNG/JPEG/GIF以外の非対応形式はundefinedを返し、
 * 呼び出し側でデフォルトアイコン表示にフォールバックさせる（誤った形式をMIMEに使うと
 * 画像デコーダが実バイトを解釈できず表示に失敗するため、決して決め打ちしない）
 */
function toIconDataUrl(bytes: Uint8Array): string | undefined {
  const format = sniffImageFormat(bytes);
  if (!format) return undefined;
  const b64 = uint8ArrayToBase64(bytes);
  if (!b64.ok) return undefined;
  return `data:${mimeTypeForImageFormat(format)};base64,${b64.value}`;
}

export async function installPlugin(
  manifest: PluginManifest,
  binary: Uint8Array,
  icon?: Uint8Array,
  sideloaded?: boolean,
): Promise<Result<void>> {
  const binRes = await binaryStore.setBinary(manifest.id, binary);
  if (!binRes.ok) return binRes;

  const iconDataUrl = icon ? toIconDataUrl(icon) : undefined;

  const entry: InstalledPlugin = {
    manifest,
    installedAt: new Date(),
    enabled: true,
    iconDataUrl,
    sideloaded,
  };
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
