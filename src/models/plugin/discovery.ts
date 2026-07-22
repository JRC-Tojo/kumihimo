import z from 'zod';

/**
 * プラグインが自己申告するエントリポイント・入力項目（非永続・実行時のみのモデル）
 *
 * これらはWASMの`describePlugin`エクスポートを発見専用の呼び出しとして実行した結果として
 * 動的に組み立てられる。`plugin.json`には一切記述されない（詳細はmanifest.tsのコメント参照）
 */
export const PluginFieldType = z.enum(['text', 'number', 'toggle', 'select']);
export type PluginFieldType = z.infer<typeof PluginFieldType>;

export const PluginField = z.object({
  fieldId: z.string(),
  label: z.string(),
  type: PluginFieldType,
  defaultValue: z.union([z.string(), z.number(), z.boolean()]),
  // type: 'select'のときのみ有効（`ui.addSelectField`のoptionsCsvを分割した値）
  options: z.string().array().optional(),
  optional: z.boolean().default(true),
});
export type PluginField = z.infer<typeof PluginField>;

export const PluginEntryPointDescriptor = z.object({
  // WASMのexport関数名と完全一致させる規約（`instance.exports[entryId]`をそのまま呼び出す）
  entryId: z.string(),
  label: z.string(),
  description: z.string(),
  fields: PluginField.array(),
});
export type PluginEntryPointDescriptor = z.infer<typeof PluginEntryPointDescriptor>;
