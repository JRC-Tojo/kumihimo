/**
 * アノテーションプリセットの新規登録処理をまとめたコンポーザブル
 *
 * `AnnotationPresetBar.vue`（MainToolsポップアップ内のプリセット追加ボタン）と
 * `AnnotationContextMenu.vue`（アノテーション右クリックメニューの「プリセットとして登録」）の
 * 両方から呼び出す共有ロジック。`style`を引数として受け取るだけで`editorStore`を一切参照しない
 * ため、呼び出し元がどのモード・選択状態から呼んでも常に渡された`style`がそのまま登録される
 * （MainToolsクリックが`currentAnnotationStyle`を書き換えてしまい、意図しない先頭プリセットの
 * スタイルが登録されてしまっていたissue #45のバグは、この設計により構造的に再発しない）
 */
import { v4 as uuidv4 } from 'uuid';
import type { useSettingsStore } from 'src/stores/settingsStore';
import type { AnnotationTool, DrawingAnnotationStyle } from 'src/models/docPage';
import { promptDialog } from 'src/components/Dialog/confirmDialog';

type SettingsStore = ReturnType<typeof useSettingsStore>;

/**
 * 指定したスタイルを新規プリセットとして登録する。名前はダイアログでユーザーに確認・変更させる
 * （デフォルト名は同種別のプリセット数から自動採番する、既存の`onAdd()`と同じ命名規則）
 * @returns 登録に成功したかどうか（ダイアログをキャンセル・空欄で確定した場合はfalse）
 */
export async function registerAnnotationPreset(
  t: (key: string, params?: Record<string, unknown>) => string,
  settingsStore: SettingsStore,
  style: DrawingAnnotationStyle,
): Promise<boolean> {
  const allPresets = settingsStore.appSettings?.tools.annotations ?? [];
  const sameTypeCount = allPresets.filter((p) => p.style.type === style.type).length;
  const defaultName = `${t(`pdfEditor.tools.${style.type}`)} ${sameTypeCount + 1}`;

  const name = await promptDialog({
    title: t('pdfEditor.tools.presetBar.add'),
    promptLabel: t('pdfEditor.tools.presetBar.nameLabel'),
    initialValue: defaultName,
    previewStyle: style,
  });
  if (name === undefined || name.trim() === '') return false;

  const newPreset: AnnotationTool = {
    id: uuidv4(),
    name,
    style,
  };
  return settingsStore.updateAnnotationPresets([...allPresets, newPreset]);
}
