/**
 * タブを閉じる際の未保存確認・一括クローズ操作をまとめるcomposable
 *
 * `DocTabsPage.vue`（通常のクローズボタン）と`TabContextMenu.vue`（右クリックメニューの
 * 一括クローズ系項目）の両方から共通利用し、未保存確認ダイアログの表示ロジックを重複させない
 */
import { useI18n } from 'vue-i18n';
import { useBackendApi } from 'src/apis/backendApi';
import { useEditorStore, type LayoutSide } from 'src/stores/editorStore';
import type { ContainerElementFile } from 'src/models/container';
import { Path } from 'src/utils/binary/path';
import { saveDocument } from 'src/utils/document/saveDocument';
import { unsavedChangesDialog } from 'src/components/Dialog/confirmDialog';

function isSameFile(a: ContainerElementFile, b: ContainerElementFile): boolean {
  return a.containerID === b.containerID && a.path === b.path;
}

export function useTabCloseActions() {
  const { t } = useI18n();
  const api = useBackendApi();
  const editorStore = useEditorStore();

  /**
   * 未保存の変更があれば保存・破棄・キャンセルを確認したうえでタブを閉じる
   * （ピン留めされている場合は`editorStore.closeTab`側で無視される）
   */
  async function closeTabWithConfirm(
    file: ContainerElementFile,
    layoutSide: LayoutSide,
  ): Promise<void> {
    const unsavedRes = await api.hasUnsavedChangesByFile(file);
    const hasUnsavedChanges = unsavedRes.ok && unsavedRes.data;

    if (hasUnsavedChanges) {
      const choice = await unsavedChangesDialog({
        title: t('explorer.unsavedChanges'),
        message: t('explorer.unsavedTabConfirm', { name: new Path(file.path).basename() }),
      });
      if (choice === 'cancel') return;
      if (choice === 'save') {
        await saveDocument(file);
      } else {
        // 保存せず閉じる：仮登録されたアノテーション・関係性を破棄し、保存前の状態へ巻き戻す
        await api.discardUnsavedChanges(file);
      }
    }

    editorStore.closeTab(file, layoutSide);
  }

  /**
   * 対象タブ一覧を、未保存確認を挟みながら順番に閉じる
   *
   * ダイアログを同時に複数出せないため、Promise.allではなく直列（for...of）で処理する。
   * ピン留めされたタブは`editorStore.closeTab`が無視するだけでなく、無駄な確認ダイアログを
   * 出さないよう事前に除外する
   */
  async function closeTabsWhere(
    layoutSide: LayoutSide,
    predicate: (file: ContainerElementFile) => boolean,
  ): Promise<void> {
    const targets = editorStore.tabs[layoutSide].filter(
      (file) => predicate(file) && !editorStore.isTabPinned(file, layoutSide),
    );
    for (const file of targets) {
      await closeTabWithConfirm(file, layoutSide);
    }
  }

  /** 指定タブ以外を全て閉じる */
  function closeOtherTabs(layoutSide: LayoutSide, keep: ContainerElementFile): Promise<void> {
    return closeTabsWhere(layoutSide, (file) => !isSameFile(file, keep));
  }

  /** 指定タブより右側にあるタブを全て閉じる */
  function closeTabsToRight(layoutSide: LayoutSide, from: ContainerElementFile): Promise<void> {
    const tabs = editorStore.tabs[layoutSide];
    const fromIdx = tabs.findIndex((file) => isSameFile(file, from));
    if (fromIdx === -1) return Promise.resolve();

    const rightFiles = new Set(tabs.slice(fromIdx + 1));
    return closeTabsWhere(layoutSide, (file) => rightFiles.has(file));
  }

  /** 保存済み（未保存の変更が無い）タブを全て閉じる */
  async function closeSavedTabs(layoutSide: LayoutSide): Promise<void> {
    const tabs = editorStore.tabs[layoutSide];
    const savedChecks = await Promise.all(
      tabs.map(async (file) => {
        const unsavedRes = await api.hasUnsavedChangesByFile(file);
        return unsavedRes.ok && !unsavedRes.data;
      }),
    );
    const savedFiles = new Set(tabs.filter((_, idx) => savedChecks[idx]));
    await closeTabsWhere(layoutSide, (file) => savedFiles.has(file));
  }

  return { closeTabWithConfirm, closeOtherTabs, closeTabsToRight, closeSavedTabs };
}
