/**
 * 「名前を付けて保存」ダイアログをQuasarの`Dialog.create`経由で呼び出すヘルパー
 */
import { Dialog } from 'quasar';
import SaveAsDialog from 'src/components/Dialog/SaveAsDialog.vue';
import type { ContainerElementFile, ContainerID } from 'src/models/container';
import type { SaveAsMode } from 'src/utils/document/saveDocumentAs';

export interface SaveAsDialogOptions {
  sourceFile: ContainerElementFile;
}

export interface SaveAsDialogResult {
  containerID: ContainerID;
  filePath: string;
  mode: SaveAsMode;
}

/**
 * 保存モード・保存先フォルダ・ファイル名を選択させるダイアログを表示する
 *
 * @returns キャンセル時は`undefined`
 */
export function saveAsDialog(opts: SaveAsDialogOptions): Promise<SaveAsDialogResult | undefined> {
  return new Promise((resolve) => {
    Dialog.create({
      component: SaveAsDialog,
      componentProps: { sourceFile: opts.sourceFile },
    })
      .onOk((result: SaveAsDialogResult) => resolve(result))
      .onCancel(() => resolve(undefined));
  });
}
