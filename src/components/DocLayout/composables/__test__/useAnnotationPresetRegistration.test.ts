import { describe, expect, it, mock } from 'bun:test';
import type { AnnotationTool, DrawingAnnotationStyle } from 'src/models/docPage';
import type { useSettingsStore } from 'src/stores/settingsStore';
import type { PromptDialogOptions } from 'src/components/Dialog/confirmDialog';

// promptDialogはQuasarのDialogプラグイン（Dialog.create）経由でUIを表示するため、
// bunのテスト環境ではモックに置き換える（このリポジトリの既存の慣習と同じ手法。
// 他ファイルとモックが競合しないよう`bun test --isolate`での実行を前提とする）
const promptDialogMock = mock(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mockImplementationOnceとの型合わせのためだけに引数を宣言する
  (_opts: PromptDialogOptions): Promise<string | undefined> => Promise.resolve('新しい名前'),
);
void mock.module('src/components/Dialog/confirmDialog', () => ({
  promptDialog: promptDialogMock,
}));

const { registerAnnotationPreset } = await import('../useAnnotationPresetRegistration');

const t = (key: string) => key;

function makeStyle(type: DrawingAnnotationStyle['type']): DrawingAnnotationStyle {
  return {
    type,
    strokeColor: '#111111',
    strokeWidth: 2,
    strokeType: 'solid',
    strokeOpacity: 1,
  } as unknown as DrawingAnnotationStyle;
}

function makeSettingsStore(existing: AnnotationTool[]) {
  const updateAnnotationPresets = mock(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    (_newList: AnnotationTool[]) => Promise.resolve(true),
  );
  const store = {
    appSettings: { tools: { annotations: existing } },
    updateAnnotationPresets,
  } as unknown as ReturnType<typeof useSettingsStore>;
  return { store, updateAnnotationPresets };
}

describe('registerAnnotationPreset', () => {
  it('渡されたstyleだけをそのまま新規プリセットとして登録する（editorStoreを一切参照しない）', async () => {
    promptDialogMock.mockResolvedValueOnce('新しい名前');
    const { store, updateAnnotationPresets } = makeSettingsStore([]);
    const style = makeStyle('box');

    const ok = await registerAnnotationPreset(t, store, style);

    expect(ok).toBe(true);
    expect(updateAnnotationPresets).toHaveBeenCalledTimes(1);
    const savedList = updateAnnotationPresets.mock.calls[0]?.[0] as AnnotationTool[];
    expect(savedList).toHaveLength(1);
    expect(savedList[0]?.style).toEqual(style);
    expect(savedList[0]?.name).toBe('新しい名前');
  });

  it('デフォルト名は同種別の既存プリセット数から採番する', async () => {
    promptDialogMock.mockImplementationOnce((opts: PromptDialogOptions) =>
      Promise.resolve(opts.initialValue),
    );
    const existing: AnnotationTool[] = [
      { id: '1', name: 'box 1', style: makeStyle('box') },
      { id: '2', name: 'line 1', style: makeStyle('line') },
    ];
    const { store, updateAnnotationPresets } = makeSettingsStore(existing);

    await registerAnnotationPreset(t, store, makeStyle('box'));

    const savedList = updateAnnotationPresets.mock.calls[0]?.[0] as AnnotationTool[];
    // 既存box系プリセットが1件のため、デフォルト名は"pdfEditor.tools.box 2"になる
    expect(savedList.at(-1)?.name).toBe('pdfEditor.tools.box 2');
  });

  it('ダイアログをキャンセル（undefined）した場合は登録せずfalseを返す', async () => {
    promptDialogMock.mockResolvedValueOnce(undefined);
    const { store, updateAnnotationPresets } = makeSettingsStore([]);

    const ok = await registerAnnotationPreset(t, store, makeStyle('box'));

    expect(ok).toBe(false);
    expect(updateAnnotationPresets).not.toHaveBeenCalled();
  });

  it('空欄で確定した場合は登録せずfalseを返す', async () => {
    promptDialogMock.mockResolvedValueOnce('   ');
    const { store, updateAnnotationPresets } = makeSettingsStore([]);

    const ok = await registerAnnotationPreset(t, store, makeStyle('box'));

    expect(ok).toBe(false);
    expect(updateAnnotationPresets).not.toHaveBeenCalled();
  });
});
