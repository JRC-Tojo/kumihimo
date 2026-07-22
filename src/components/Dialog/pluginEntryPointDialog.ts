/**
 * プラグインのエントリポイント入力ダイアログの呼び出しヘルパー
 *
 * `confirmDialog.ts`と同じく、`PluginEntryPointDialog.vue`を`Dialog.create`経由で呼び出す
 */
import { Dialog } from 'quasar';
import PluginEntryPointDialog from 'src/components/Dialog/PluginEntryPointDialog.vue';
import type { PluginField } from 'src/models/plugin/discovery';

export interface PluginEntryPointDialogOptions {
  pluginName: string;
  fields: PluginField[];
}

/**
 * プラグインが自己申告した入力項目を動的にレンダリングするダイアログを表示する
 * （キャンセル時は`undefined`を返す）
 */
export function invokePluginEntryPointDialog(
  opts: PluginEntryPointDialogOptions,
): Promise<Record<string, string | number | boolean> | undefined> {
  return new Promise((resolve) => {
    Dialog.create({
      component: PluginEntryPointDialog,
      componentProps: {
        pluginName: opts.pluginName,
        fields: opts.fields,
      },
    })
      .onOk((value: Record<string, string | number | boolean>) => resolve(value))
      .onCancel(() => resolve(undefined));
  });
}
