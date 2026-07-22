/**
 * 「導入可能プラグイン一覧」（カタログ）
 *
 * プラグインストア・リポジトリ（https://github.com/JRC-Tojo/RD-PluginStock）の
 * `plugins/<id>/plugin.json`を実際に読みに行く。認証（token）は未指定でも動作するが
 * （公開リポジトリのため）、GitHub APIのレート制限緩和のため設定されていれば利用する
 */
import type { CatalogEntry } from 'src/models/plugin/installation';
import { PluginManifest } from 'src/models/plugin/manifest';
import type { Result } from 'src/models/error/result';
import { Failure, Success } from 'src/models/error/result';
import {
  STORE_REPO_OWNER,
  STORE_REPO_NAME,
  STORE_REPO_DEFAULT_BRANCH,
  getTree,
  buildRawFileUrl,
  fetchRawText,
  fetchRawBinary,
} from 'src/repositories/plugin/githubApi';

const PLUGIN_JSON_PATH_PATTERN = /^plugins\/([^/]+)\/plugin\.json$/;

export async function getCatalogEntries(token?: string): Promise<Result<CatalogEntry[]>> {
  const treeRes = await getTree(
    STORE_REPO_OWNER,
    STORE_REPO_NAME,
    STORE_REPO_DEFAULT_BRANCH,
    token,
  );
  if (!treeRes.ok) return treeRes;

  const manifestPaths = treeRes.value.filter((path) => PLUGIN_JSON_PATH_PATTERN.test(path));

  const entries: CatalogEntry[] = [];
  for (const path of manifestPaths) {
    const url = buildRawFileUrl(STORE_REPO_OWNER, STORE_REPO_NAME, STORE_REPO_DEFAULT_BRANCH, path);
    const textRes = await fetchRawText(url);
    if (!textRes.ok) continue; // 個別ファイルの取得失敗はスキップし、カタログ全体は返す

    let json: unknown;
    try {
      json = JSON.parse(textRes.value);
    } catch {
      continue;
    }
    const parsed = PluginManifest.safeParse(json);
    if (!parsed.success) continue;
    if (parsed.data.deprecated) continue; // unpublish済みは一覧から除外する

    const iconUrl = parsed.data.iconFile
      ? buildRawFileUrl(
          STORE_REPO_OWNER,
          STORE_REPO_NAME,
          STORE_REPO_DEFAULT_BRANCH,
          `plugins/${parsed.data.id}/${parsed.data.iconFile}`,
        )
      : undefined;

    entries.push({ manifest: parsed.data, publishedAt: new Date(), iconUrl });
  }

  return Success(entries);
}

export function getCatalogBinary(
  manifest: PluginManifest,
  token?: string,
): Promise<Result<Uint8Array>> {
  const url = buildRawFileUrl(
    STORE_REPO_OWNER,
    STORE_REPO_NAME,
    STORE_REPO_DEFAULT_BRANCH,
    `plugins/${manifest.id}/${manifest.mainFile}`,
  );
  // raw.githubusercontent.comは認証不要（公開リポジトリのため）だが、将来非公開運用に
  // 切り替わった場合に備えtokenパラメータ自体は残しておく（現状は未使用）
  void token;
  return fetchRawBinary(url);
}

export async function getCatalogIcon(manifest: PluginManifest): Promise<Result<Uint8Array>> {
  if (!manifest.iconFile) return Failure(new Error('This plugin has no icon'));
  const url = buildRawFileUrl(
    STORE_REPO_OWNER,
    STORE_REPO_NAME,
    STORE_REPO_DEFAULT_BRANCH,
    `plugins/${manifest.id}/${manifest.iconFile}`,
  );
  return fetchRawBinary(url);
}
