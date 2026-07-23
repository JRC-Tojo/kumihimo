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
import { Path } from 'src/utils/binary/path';
import {
  STORE_REPO_OWNER,
  STORE_REPO_NAME,
  STORE_REPO_DEFAULT_BRANCH,
  getTree,
  buildRawFileUrl,
  fetchRawText,
  fetchRawBinary,
  getLastCommitDateForPath,
} from 'src/repositories/plugin/githubApi';

const PLUGIN_JSON_PATH_PATTERN = /^plugins\/([^/]+)\/plugin\.json$/;
const PLUGINS_ROOT = new Path('plugins');

/** ストアリポジトリの`plugins/<id>/`配下にあるファイルの相対パスを組み立てる */
function pluginFilePath(pluginId: string, fileName: string): string {
  return PLUGINS_ROOT.child(pluginId, fileName).path;
}

/**
 * ストアリポジトリを走査し、公開中（`deprecated`でない）プラグイン一覧を取得する
 *
 * `plugins/<id>/plugin.json`ごとに①内容の取得②実際の公開日時（最終コミット日時）の
 * 取得を並列で行う（raw.githubusercontent.comはAPIレート制限を消費しないため）
 */
export async function getCatalogEntries(token?: string): Promise<Result<CatalogEntry[]>> {
  const treeRes = await getTree(
    STORE_REPO_OWNER,
    STORE_REPO_NAME,
    STORE_REPO_DEFAULT_BRANCH,
    token,
  );
  if (!treeRes.ok) return treeRes;

  const manifestPaths = treeRes.value.filter((path) => PLUGIN_JSON_PATH_PATTERN.test(path));

  const entries = await Promise.all(manifestPaths.map((path) => loadCatalogEntry(path, token)));

  return Success(entries.filter((entry) => entry !== undefined));
}

/** 1件分のplugin.jsonを取得・検証し、カタログエントリへ変換する（取得・検証に失敗した場合はundefined） */
async function loadCatalogEntry(
  manifestPath: string,
  token: string | undefined,
): Promise<CatalogEntry | undefined> {
  const url = buildRawFileUrl(
    STORE_REPO_OWNER,
    STORE_REPO_NAME,
    STORE_REPO_DEFAULT_BRANCH,
    manifestPath,
  );
  const textRes = await fetchRawText(url);
  if (!textRes.ok) return undefined; // 個別ファイルの取得失敗はスキップし、カタログ全体は返す

  let json: unknown;
  try {
    json = JSON.parse(textRes.value);
  } catch {
    return undefined;
  }
  const parsed = PluginManifest.safeParse(json);
  if (!parsed.success) return undefined;
  if (parsed.data.deprecated) return undefined; // unpublish済みは一覧から除外する

  const iconUrl = parsed.data.iconFile
    ? buildRawFileUrl(
        STORE_REPO_OWNER,
        STORE_REPO_NAME,
        STORE_REPO_DEFAULT_BRANCH,
        pluginFilePath(parsed.data.id, parsed.data.iconFile),
      )
    : undefined;

  const commitDateRes = await getLastCommitDateForPath(
    STORE_REPO_OWNER,
    STORE_REPO_NAME,
    manifestPath,
    STORE_REPO_DEFAULT_BRANCH,
    token,
  );
  // 取得できない場合のみ取得時刻へフォールバックする（実際の公開日時が分かる場合はそちらを優先する）
  const publishedAt = commitDateRes.ok ? commitDateRes.value : new Date();

  return { manifest: parsed.data, publishedAt, iconUrl };
}

/** プラグイン本体のバイナリを取得する */
export function getCatalogBinary(
  manifest: PluginManifest,
  token?: string,
): Promise<Result<Uint8Array>> {
  const url = buildRawFileUrl(
    STORE_REPO_OWNER,
    STORE_REPO_NAME,
    STORE_REPO_DEFAULT_BRANCH,
    pluginFilePath(manifest.id, manifest.mainFile),
  );
  // raw.githubusercontent.comは認証不要（公開リポジトリのため）だが、将来非公開運用に
  // 切り替わった場合に備えtokenパラメータ自体は残しておく（現状は未使用）
  void token;
  return fetchRawBinary(url);
}

/** プラグインのアイコン画像を取得する（`iconFile`未指定の場合は失敗を返す） */
export function getCatalogIcon(manifest: PluginManifest): Promise<Result<Uint8Array>> {
  if (!manifest.iconFile) return Promise.resolve(Failure(new Error('This plugin has no icon')));
  const url = buildRawFileUrl(
    STORE_REPO_OWNER,
    STORE_REPO_NAME,
    STORE_REPO_DEFAULT_BRANCH,
    pluginFilePath(manifest.id, manifest.iconFile),
  );
  return fetchRawBinary(url);
}
