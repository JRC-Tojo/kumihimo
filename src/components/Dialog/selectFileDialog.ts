/**
 * 全コンテナを横断してPDFファイルを1つ選択するダイアログの呼び出しヘルパー
 *
 * プラグインの入力フィールド`type: 'file'`（`ui.addFileField`で宣言される）向け。
 * Explorer本体の選択・DnD・コンテキストメニューとは独立した、選択専用の軽量実装
 * （`SelectFileDialog.vue`）をQuasarの`Dialog.create`経由で呼び出す
 */
import { Dialog } from 'quasar';
import SelectFileDialog from 'src/components/Dialog/SelectFileDialog.vue';
import type { ContainerElementFile } from 'src/models/container';

export interface SelectFileDialogOptions {
  title: string;
}

/**
 * ファイル選択ダイアログを表示する。キャンセル時は`undefined`を返す
 */
export function selectFileDialog(
  opts: SelectFileDialogOptions,
): Promise<ContainerElementFile | undefined> {
  return new Promise((resolve) => {
    Dialog.create({
      component: SelectFileDialog,
      componentProps: {
        title: opts.title,
      },
    })
      .onOk((file: ContainerElementFile) => resolve(file))
      .onCancel(() => resolve(undefined));
  });
}
