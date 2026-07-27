/**
 * 完了までに時間のかかる処理向けの、進捗（完了件数/総件数）付きの非対話ダイアログ表示ヘルパー
 *
 * `ConfirmDialog`と異なりOK/キャンセル操作を持たず、呼び出し側が処理の進行に合わせて
 * `update`で表示内容を書き換え、完了時に`hide`で閉じる想定で使う
 */
import { Dialog } from 'quasar';
import ProgressDialog from 'src/components/Dialog/ProgressDialog.vue';

export interface ProgressDialogHandle {
  /** 進捗を更新する。`total`が0のままなら不確定（indeterminate）表示になる */
  update: (completed: number, total: number) => void;
  hide: () => void;
}

export function showProgressDialog(title: string, message: string): ProgressDialogHandle {
  const chain = Dialog.create({
    component: ProgressDialog,
    componentProps: { title, message, completed: 0, total: 0 },
  });

  return {
    update: (completed, total) => {
      chain.update({ title, message, completed, total });
    },
    hide: () => chain.hide(),
  };
}
