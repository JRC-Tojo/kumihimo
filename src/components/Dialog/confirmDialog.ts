/**
 * 確認・入力・未保存確認ダイアログの共通呼び出しヘルパー
 *
 * `ConfirmDialog.vue`をQuasarの`Dialog.create({component, componentProps})`経由で
 * 呼び出すことで、スタイルの変更が1ファイルの修正のみで完結するようにする
 */
import { Dialog } from 'quasar';
import ConfirmDialog from 'src/components/Dialog/ConfirmDialog.vue';
import type { DrawingAnnotationStyle } from 'src/models/docPage';

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
  /** 指定した場合、入力欄の上に新規追加スタイルのプレビューを表示する（プリセット登録画面向け） */
  previewStyle?: DrawingAnnotationStyle;
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
        previewStyle: opts.previewStyle,
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

export interface FontEmbedRiskDialogOptions {
  title: string;
  message: string;
}

/**
 * フォント埋め込みリスクの警告ダイアログ（キャンセル／このまま保存の2択）
 *
 * Local Font Access APIは一度拒否されると（ブラウザの仕様上）スクリプトから再度許可を
 * 要求することができないため、再試行ボタンは持たない。`message`側で、対応ブラウザで拒否
 * されている場合はサイト設定から手動で許可し直す手順を、非対応ブラウザの場合は対応ブラウザで
 * 開き直すよう促す文言を、呼び出し側が状況に応じて出し分けること
 */
export function fontEmbedRiskDialog(
  opts: FontEmbedRiskDialogOptions,
): Promise<'proceed' | 'cancel'> {
  return new Promise((resolve) => {
    Dialog.create({
      component: ConfirmDialog,
      componentProps: {
        title: opts.title,
        message: opts.message,
        variant: 'fontEmbedRisk',
      },
    })
      .onOk((value: 'proceed') => resolve(value))
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
