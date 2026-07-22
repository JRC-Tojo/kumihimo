/**
 * 確認・入力・未保存確認ダイアログの共通呼び出しヘルパー
 *
 * `ConfirmDialog.vue`をQuasarの`Dialog.create({component, componentProps})`経由で
 * 呼び出すことで、スタイルの変更が1ファイルの修正のみで完結するようにする
 */
import { Dialog } from 'quasar';
import ConfirmDialog from 'src/components/Dialog/ConfirmDialog.vue';

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  severity?: 'normal' | 'negative';
}

/**
 * OK/キャンセルの確認ダイアログを表示する
 */
export function confirmDialog(opts: ConfirmDialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    Dialog.create({
      component: ConfirmDialog,
      componentProps: {
        title: opts.title,
        message: opts.message,
        variant: 'confirm',
        severity: opts.severity ?? 'normal',
      },
    })
      .onOk(() => resolve(true))
      .onCancel(() => resolve(false));
  });
}

export interface PromptDialogOptions {
  title: string;
  message?: string;
  promptLabel?: string;
  initialValue?: string;
}

/**
 * テキスト入力付きの確認ダイアログを表示する（キャンセル時は`undefined`を返す）
 */
export function promptDialog(opts: PromptDialogOptions): Promise<string | undefined> {
  return new Promise((resolve) => {
    Dialog.create({
      component: ConfirmDialog,
      componentProps: {
        title: opts.title,
        message: opts.message ?? '',
        variant: 'prompt',
        promptLabel: opts.promptLabel ?? '',
        promptInitialValue: opts.initialValue ?? '',
      },
    })
      .onOk((value: string) => resolve(value))
      .onCancel(() => resolve(undefined));
  });
}

export interface ImportPresetsDialogOptions {
  title: string;
  message: string;
}

/**
 * プリセットインポート時、既存プリセットへの追加か完全な置き換えかを選択させる3択ダイアログを表示する
 */
export function importPresetsDialog(
  opts: ImportPresetsDialogOptions,
): Promise<'append' | 'replace' | 'cancel'> {
  return new Promise((resolve) => {
    Dialog.create({
      component: ConfirmDialog,
      componentProps: {
        title: opts.title,
        message: opts.message,
        variant: 'importPresets',
      },
    })
      .onOk((value: 'append' | 'replace') => resolve(value))
      .onCancel(() => resolve('cancel'));
  });
}

export interface UnsavedChangesDialogOptions {
  title: string;
  message: string;
}

/**
 * 未保存の変更があるタブを閉じる際の3択ダイアログを表示する
 */
export function unsavedChangesDialog(
  opts: UnsavedChangesDialogOptions,
): Promise<'save' | 'discard' | 'cancel'> {
  return new Promise((resolve) => {
    Dialog.create({
      component: ConfirmDialog,
      componentProps: {
        title: opts.title,
        message: opts.message,
        variant: 'unsavedChanges',
      },
    })
      .onOk((value: 'save' | 'discard') => resolve(value))
      .onCancel(() => resolve('cancel'));
  });
}
