import z from 'zod';

/**
 * プラグインの識別子（開発者が指定する文字列。UUIDではない）
 */
export const PluginID = z.string().min(1).brand('PluginID');
export type PluginID = z.infer<typeof PluginID>;

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
  mainFile: z.string().min(1),
  requiredHostApis: PluginHostApiName.array().default([]),
});
export type PluginManifest = z.infer<typeof PluginManifest>;
