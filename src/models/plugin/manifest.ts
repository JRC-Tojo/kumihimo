import z from 'zod';

/**
 * プラグインの識別子（開発者が指定する文字列。UUIDではない）
 *
 * ストアリポジトリ内のディレクトリ名・パス組み立て（`pluginFilePath`）や、申請フローの
 * GitHubブランチ名（`plugin/<id>`等）へそのまま埋め込まれるため、英数字とハイフンのみの
 * スラッグに制限する。これ以外の文字（`..`や`/`等）を許すと、パスの正規化でプラグイン領域外を
 * 指したり、Gitのref命名規則に反してブランチ作成が失敗したりする
 */
export const PluginID = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, '英数字（小文字）とハイフンのみのスラッグを指定してください')
  .brand('PluginID');
export type PluginID = z.infer<typeof PluginID>;

/**
 * `plugin.json`と同じディレクトリ内を指す、traversalを含まない相対ファイル名かどうかを検証する
 *
 * `mainFile`/`iconFile`はストアリポジトリ（外部由来）の`plugin.json`が自己申告する値のため、
 * `../`等で兄弟プラグインのディレクトリや任意のパスを指せてしまうと、取得先URLの組み立て
 * （`utils/binary/path`の`Path.child()`）でプラグイン領域外に到達しうる。絶対パス・空文字・
 * `.`/`..`セグメントを禁止し、単純な相対ファイル名のみを許可する
 */
function isSafePluginRelativeFile(value: string): boolean {
  if (value.length === 0 || value.startsWith('/') || value.startsWith('\\')) return false;
  const segments = value.split(/[\\/]+/);
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

const PluginRelativeFile = z
  .string()
  .min(1)
  .refine(isSafePluginRelativeFile, 'traversalを含まない相対ファイル名を指定してください');

/**
 * プラグインの実行ランタイム
 *
 * 'pyodide'は次イテレーションで実装予定（現状はサービス層で未実装スタブとして扱う）
 */
export const PluginRuntime = z.enum(['wasm', 'pyodide']);
export type PluginRuntime = z.infer<typeof PluginRuntime>;

/**
 * プラグインが要求できるホストAPI名（最小権限の対象）
 *
 * 画面構築API（`ui.registerEntryPoint`/`ui.addTextField`等）はここに含めない。
 * これらは`describePlugin`の発見専用呼び出し内でのみ使用可能で、常時付与されるため
 */
export const PluginHostApiName = z.enum([
  'ui.reportProgress',
  'ui.log',
  'ui.reportError',
  'plan.setConfirmationMode',
  'plan.addAnnotation',
  'plan.updateAnnotation',
  'plan.removeAnnotation',
  'plan.addRelational',
  'plan.removeRelational',
  'doc.getProjectMetadata',
  'doc.getPageSize',
  'doc.getPageTextBlocks',
  'doc.getPageImage',
  'doc.getAnnotationsByFile',
  'doc.getAnnotationIdsByTag',
]);
export type PluginHostApiName = z.infer<typeof PluginHostApiName>;

/**
 * プラグインのメタ情報（`plugin.json`の内容）
 *
 * エントリポイント・入力項目はここに含めない。これらはWASM自身が`describePlugin`エクスポート
 * から実行時に自己申告する（`src/models/plugin/discovery.ts`参照）ため、静的JSONと実装コードの
 * 記述漏れ・ズレが原理的に起きない構造にしている
 */
export const PluginManifest = z.object({
  id: PluginID,
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().default(''),
  runtime: PluginRuntime,
  mainFile: PluginRelativeFile,
  // 一覧表示用のアイコン画像ファイル名（plugin.jsonと同じディレクトリ内）。未指定時はデフォルトアイコンを表示する
  iconFile: PluginRelativeFile.optional(),
  // このプラグインを最初に公開したGitHubユーザー名。なりすまし更新を防ぐため、ストアリポジトリの
  // CI（validateManifest.mjs）がPR作成者と突き合わせて検証する。新規申請時はアプリが自動設定する
  owner: z.string().min(1).optional(),
  // trueの場合、カタログ一覧・検索結果から除外する（unpublish）。実ファイルは履歴に残したまま、
  // 表示のみを止める運用とする
  deprecated: z.boolean().optional(),
  requiredHostApis: PluginHostApiName.array().default([]),
});
export type PluginManifest = z.infer<typeof PluginManifest>;
