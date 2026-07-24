/**
 * プラグインのインストール・アンインストール・一覧取得を扱う
 */
import type { Result } from 'src/models/error/result';
import { Failure } from 'src/models/error/result';
import { PluginID, PluginManifest } from 'src/models/plugin/manifest';
import type {
  InstalledPlugin,
  CatalogEntry,
  PluginInstallSource,
} from 'src/models/plugin/installation';
import type { PluginSubmissionDraft } from 'src/models/plugin/submission';
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

/**
 * プラグインをインストールする。同一`manifest.id`であっても`source`（catalog/sideload）
 * ごとに別レコードとして共存する（`src/repositories/db/plugin.ts`参照）
 */
export async function installPlugin(
  manifest: PluginManifest,
  binary: Uint8Array,
  icon: Uint8Array | undefined,
  source: PluginInstallSource,
): Promise<Result<void>> {
  const binRes = await binaryStore.setBinary(manifest.id, source, binary);
  if (!binRes.ok) return binRes;

  const iconDataUrl = icon ? toIconDataUrl(icon) : undefined;

  const entry: InstalledPlugin = {
    manifest,
    installedAt: new Date(),
    enabled: true,
    iconDataUrl,
    source,
  };
  return pluginDb.putInstalledPlugin(entry);
}

/**
 * サイドロード用: `id`/`owner`を持たない開発者入力（フォーム由来）から直接インストールする
 *
 * 同名（`source: 'sideload'`のもの限定）の既存インストールがあれば、そのidを再利用して
 * 上書きする（プラグイン開発中に「ビルドし直して再インストール」を繰り返しても、毎回
 * 別レコードとして積み上がらないようにするため）。同名の既存インストールが無ければ
 * 新規にUUIDを採番する
 */
export async function installFromDraft(
  draft: PluginSubmissionDraft,
  binary: Uint8Array,
  icon: Uint8Array | undefined,
): Promise<Result<void>> {
  const installedRes = await pluginDb.getInstalledPlugins();
  if (!installedRes.ok) return installedRes;
  const existing = installedRes.value.find(
    (e) => e.source === 'sideload' && e.manifest.name === draft.name,
  );

  const id = existing ? existing.manifest.id : PluginID.parse(crypto.randomUUID());
  const manifest: PluginManifest = PluginManifest.parse({ ...draft, id });
  return installPlugin(manifest, binary, icon, 'sideload');
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

  return installPlugin(entry.manifest, binRes.value, icon, 'catalog');
}

export async function uninstallPlugin(
  id: PluginID,
  source: PluginInstallSource,
): Promise<Result<void>> {
  const delBinRes = await binaryStore.deleteBinary(id, source);
  if (!delBinRes.ok) return delBinRes;
  return pluginDb.deleteInstalledPlugin(id, source);
}

export async function setPluginEnabled(
  id: PluginID,
  source: PluginInstallSource,
  enabled: boolean,
): Promise<Result<void>> {
  const current = await pluginDb.getInstalledPlugin(id, source);
  if (!current.ok) return current;
  return pluginDb.putInstalledPlugin({ ...current.value, enabled });
}

export function getPluginBinary(
  id: PluginID,
  source: PluginInstallSource,
): Promise<Result<Uint8Array>> {
  return binaryStore.getBinary(id, source);
}
