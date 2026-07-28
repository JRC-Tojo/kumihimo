import z from 'zod';

/**
 * プラグインが自己申告するエントリポイント・入力項目（非永続・実行時のみのモデル）
 *
 * これらはWASMの`describePlugin`エクスポートを発見専用の呼び出しとして実行した結果として
 * 動的に組み立てられる。`plugin.json`には一切記述されない（詳細はmanifest.tsのコメント参照）
 */
export const PluginFieldType = z.enum(['text', 'number', 'toggle', 'select', 'file']);
export type PluginFieldType = z.infer<typeof PluginFieldType>;

const PluginFieldBase = z.object({
  fieldId: z.string(),
  label: z.string(),
  optional: z.boolean().default(true),
});

/**
 * 入力フィールドの型ごとに`defaultValue`の型を対応させたdiscriminated union
 *
 * 単一スキーマで`defaultValue: string|number|boolean`のように緩く定義すると、
 * 例えば`type: 'number'`に文字列の既定値が混入する等、UIが描画時に前提とする
 * 型と実データがズレたまま通過してしまう。型ごとに分離することでその不整合を防ぐ
 */
export const PluginTextField = PluginFieldBase.extend({
  type: z.literal('text'),
  defaultValue: z.string(),
});
export const PluginNumberField = PluginFieldBase.extend({
  type: z.literal('number'),
  defaultValue: z.number(),
});
export const PluginToggleField = PluginFieldBase.extend({
  type: z.literal('toggle'),
  defaultValue: z.boolean(),
});
export const PluginSelectField = PluginFieldBase.extend({
  type: z.literal('select'),
  defaultValue: z.string(),
  // `ui.addSelectField`のoptionsCsvを分割した値。selectでは必須
  options: z.string().array().min(1),
}).refine((field) => field.options.includes(field.defaultValue), {
  message: 'defaultValueはoptionsに含まれる値である必要があります',
  path: ['defaultValue'],
});
/**
 * 処理対象文書を1件選択させるフィールド（`ui.addFileField`で宣言される）
 *
 * 値そのもの（`ContainerElementFile`）はWASMの数値/文字列引数として渡せないため、
 * この型のフィールドはエントリポイント実行時の位置引数（positionalArgs）には含まれず、
 * ホスト側が実行前にファイル選択ダイアログで解決し、`targetFiles`として別途扱う
 * （`services/plugin/run.ts`参照）。既定値という概念がないため`defaultValue`を持たない
 */
export const PluginFileField = PluginFieldBase.extend({
  type: z.literal('file'),
});

export const PluginField = z.discriminatedUnion('type', [
  PluginTextField,
  PluginNumberField,
  PluginToggleField,
  PluginSelectField,
  PluginFileField,
]);
export type PluginField = z.infer<typeof PluginField>;

/**
 * `ai.declareVisionTask`（発見専用API）で宣言される、ページ画像に対するONNXビジョン
 * 言語モデルの推論タスク。特定のモデル・特定のプラグイン用途に依らない汎用の宣言で、
 * `modelId`（Hugging Face Hub上のtransformers.js対応モデルのリポジトリID）と
 * `task`（そのモデルへ渡すプロンプト/タスク指示文字列）を自由に指定できる。
 *
 * WASMのホスト関数は同期呼び出しのみ可能な一方、モデル推論は本質的に非同期（かつ
 * WebGPU実行を想定するとなおさら）であるため、`file`型フィールドと同様に
 * 「discoverePlugin時に宣言→実行前にホストが対象ファイルの全ページ分を事前解決→
 * 実行時は`ai.getVisionTaskResult`で結果を参照するだけ」という方式を取る
 */
export const PluginVisionTask = z.object({
  taskId: z.string(),
  modelId: z.string(),
  task: z.string(),
});
export type PluginVisionTask = z.infer<typeof PluginVisionTask>;

export const PluginEntryPointDescriptor = z.object({
  // WASMのexport関数名と完全一致させる規約（`instance.exports[entryId]`をそのまま呼び出す）
  entryId: z.string(),
  label: z.string(),
  description: z.string(),
  fields: PluginField.array(),
  visionTasks: PluginVisionTask.array().default([]),
});
export type PluginEntryPointDescriptor = z.infer<typeof PluginEntryPointDescriptor>;
