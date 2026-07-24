/**
 * アノテーションプリセット一覧のJSONインポート／エクスポートに関するロジックをまとめたコンポーザブル
 *
 * `useAnnotationPresets.ts`はストア・APIに依存しない純粋な関数のみで構成し単体テスト対象と
 * しているため、バックエンドAPI・設定ストアに依存するインポート処理はあえて本ファイルへ分離する
 * （同一ファイルにまとめると、単体テストが対象外の関数越しにストア初期化処理まで読み込んでしまう）
 */

import { v4 as uuidv4 } from 'uuid';
import { AnnotationTool } from 'src/models/docPage';
import { useBackendApi } from 'src/apis/backendApi';
import { useSettingsStore } from 'src/stores/settingsStore';

export type ImportPresetsMode = 'replace' | 'append';

export type ParseImportedPresetsResult =
  { success: true; presets: AnnotationTool[] } | { success: false; reason: 'parse' | 'validation' };

/**
 * インポートしたJSONテキストをプリセット一覧として検証・パースする
 *
 * JSON構文自体が不正な場合と、構文は正しいがプリセットのスキーマに一致しない場合とを
 * `reason`で区別できるようにし、呼び出し側でそれぞれ異なるメッセージを表示できるようにする
 */
export function parseImportedPresets(jsonText: string): ParseImportedPresetsResult {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonText);
  } catch {
    return { success: false, reason: 'parse' };
  }

  const parsed = AnnotationTool.array().safeParse(parsedJson);
  if (!parsed.success) return { success: false, reason: 'validation' };
  return { success: true, presets: parsed.data };
}

/**
 * インポートされたプリセットにIDを再採番する
 *
 * 他環境からのインポート・同一ファイルの再インポート時にIDが衝突しないよう、常に新規採番し直す
 */
export function regenerateImportedPresetIds(presets: AnnotationTool[]): AnnotationTool[] {
  return presets.map((preset) => ({ ...preset, id: uuidv4() }));
}

/**
 * インポートしたプリセットを、既存プリセットへの追加または完全な置き換えとして保存する
 *
 * 追記(append)の場合、設定画面を開いている間に他所（プリセットバー等）で加えられた変更を
 * 上書き・破棄しないよう、マージ直前にバックエンドから最新のプリセット一覧を読み直す
 * @returns 保存に成功したかどうか
 */
export async function applyImportedPresets(
  imported: AnnotationTool[],
  mode: ImportPresetsMode,
): Promise<boolean> {
  const settingsStore = useSettingsStore();

  let current: AnnotationTool[] = [];
  if (mode === 'append') {
    const api = useBackendApi();
    const latest = await api.getSettings();
    current = latest.ok ? latest.data.tools.annotations : [];
  }

  const newList = mode === 'replace' ? imported : [...current, ...imported];
  return settingsStore.updateAnnotationPresets(newList);
}
