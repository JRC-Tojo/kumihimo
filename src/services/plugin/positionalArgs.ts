/**
 * WASMエントリポイントへ渡す位置引数の組み立てロジック
 *
 * `run.ts`から分離しているのは、この関数自体は`PluginExecutionContext`の**型**にしか
 * 依存せず、`hostContext.ts`が実際に持つ重い実行時依存（pdf.js等、ブラウザAPI前提）を
 * 一切必要としないため。`pluginSdk/devTools/runPlugin.ts`（Bun上で動く開発者向けCLI）が
 * `run.ts`を経由せずこの関数だけをimportできるようにし、ブラウザ専用APIへの依存を
 * 引き込まずに済むようにしている
 */
import type { PluginEntryPointDescriptor, PluginField } from 'src/models/plugin/discovery';
import type { PluginExecutionContext } from 'src/services/plugin/hostContext';

/** `file`型以外のフィールドかどうかの型ガード（`defaultValue`を持つ変種に絞り込む） */
function isNonFileField(field: PluginField): field is Exclude<PluginField, { type: 'file' }> {
  return field.type !== 'file';
}

/**
 * 引数順: [システムコンテキスト] targetFileCount, pageCount, pageWidth, pageHeight →
 * [discover宣言順のfileを除くユーザー入力値]。pageCount/width/heightはtargetFiles[0]
 * （主対象ファイル）の値。file型フィールドはWASMへ値として渡せないため位置引数には含めない
 *
 * アプリ本体（`run.ts`の`runEntryPoint`）と`pluginSdk/devTools/runPlugin.ts`のCLIツールの
 * 両方がこの関数を共有する。CLIが実アプリと異なる引数順序で「動いてしまう」誤検知を防ぐため
 */
export function buildPositionalArgs(
  descriptor: PluginEntryPointDescriptor,
  fieldValues: Record<string, string | number | boolean>,
  ctx: PluginExecutionContext,
): Array<string | number | boolean> {
  return [
    ctx.targetFiles.length,
    ctx.fileContexts[0]?.pageCount ?? 0,
    ctx.representativePageSize.width,
    ctx.representativePageSize.height,
    ...descriptor.fields
      .filter(isNonFileField)
      .map((field) => fieldValues[field.fieldId] ?? field.defaultValue),
  ];
}
