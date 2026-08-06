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

/**
 * 同一ファイル判定ユーティリティ
 * @param a 比較対象1
 * @param b 比較対象2
 * @returns containerID と path が一致する場合に true
 */
function isSameFile(a: ContainerElementFile, b: ContainerElementFile): boolean {
  return a.containerID === b.containerID && a.path === b.path;
}

/**
 * タブクローズ操作をまとめた composable
 *
 * このモジュールは以下の責務を持つ。
 * - 個別タブを閉じる際の未保存変更の確認と保存／破棄処理
 * - 複数タブに対する一括クローズ処理（直列実行）
 *
 * DocTabsPage.vue と TabContextMenu.vue の双方から利用されるため、ダイアログ表示等の
 * ユーザーインタラクションを集中管理する。
 */
export function useTabCloseActions() {
  const { t } = useI18n();
  const api = useBackendApi();
  const editorStore = useEditorStore();

  /**
   * 指定タブがピン留めされているか確認し、未保存確認を含めてタブを閉じる。
   *
   * 流れ:
   * 1. タブがピン留めされていれば何もしない（未保存データを破棄しない）
   * 2. 編集状態の判定（api.hasUnsavedChangesByFile）を行う。判定に失敗した場合は処理を中止しエラーを通知する
   * 3. 未保存がある場合、ユーザーへダイアログで確認する（保存／破棄／キャンセル）
   *    - 保存: saveDocument を呼ぶ。失敗したら中止してエラー表示
   *    - 破棄: api.discardUnsavedChanges を呼ぶ。失敗したら中止してエラー表示
   *    - キャンセル: 何もしない（呼び出し元へキャンセルを通知）
   * 4. 上記が正常に完了したら editorStore.closeTab を呼ぶ
   *
   * 戻り値: タブを実際に閉じた場合に true、ユーザーがキャンセルしたかエラーで中断した場合に false
   */
  async function closeTabWithConfirm(
    file: ContainerElementFile,
    layoutSide: LayoutSide,
  ): Promise<boolean> {
    // 1) ピン留めされているタブは未保存データを破棄しないため即時終了
    if (editorStore.isTabPinned(file, layoutSide)) return false;

    // 2) 未保存判定を問い合わせる
    const unsavedRes = await api.hasUnsavedChangesByFile(file);
    if (!unsavedRes.ok) {
      // 判定できない場合はクローズを中止し、ステータスメッセージで通知する
      editorStore.postStatusMessage(
        'tab-close',
        t('message.error') + `: ${t('explorer.unsavedChanges')}`,
      );
      return false;
    }

    const hasUnsavedChanges = unsavedRes.data;

    if (hasUnsavedChanges) {
      // 3) ユーザーに保存／破棄／キャンセルの選択を促す
      const choice = await unsavedChangesDialog({
        title: t('explorer.unsavedChanges'),
        message: t('explorer.unsavedTabConfirm', { name: new Path(file.path).basename() }),
      });
      if (choice === 'cancel') return false;

      if (choice === 'save') {
        // 保存処理。失敗したら中断してエラーメッセージを表示
        try {
          await saveDocument(file);
        } catch (err) {
          editorStore.postStatusMessage('tab-close', t('message.error'));
          return false;
        }
      } else {
        // 保存せず破棄する。APIの結果が失敗したら中断してエラーを表示
        const discardRes = await api.discardUnsavedChanges(file);
        if (!discardRes.ok) {
          editorStore.postStatusMessage('tab-close', t('message.error'));
          return false;
        }
      }
    }

    // 4) 最後にタブを閉じる（editorStore側でピン留めなら無視される）
    editorStore.closeTab(file, layoutSide);
    return true;
  }

  /**
   * 対象タブ一覧を、未保存確認を挟みながら順番に閉じる
   *
   * ダイアログは直列で表示する必要があるため for...of で処理する。
   * 各ファイルについて closeTabWithConfirm が false を返した場合は、それが
   * ユーザーのキャンセルまたはエラーを示すため、以降の処理を中止する。
   * ピン留めされたタブは事前に除外して無駄な確認ダイアログを出さない。
   */
  async function closeTabsWhere(
    layoutSide: LayoutSide,
    predicate: (file: ContainerElementFile) => boolean,
  ): Promise<void> {
    const targets = editorStore.tabs[layoutSide].filter(
      (file) => predicate(file) && !editorStore.isTabPinned(file, layoutSide),
    );
    for (const file of targets) {
      const ok = await closeTabWithConfirm(file, layoutSide);
      if (!ok) break; // ユーザーがキャンセルした or エラーが発生した場合は後続を中止
    }
  }

  /**
   * 指定タブ以外を全て閉じる
   */
  function closeOtherTabs(layoutSide: LayoutSide, keep: ContainerElementFile): Promise<void> {
    return closeTabsWhere(layoutSide, (file) => !isSameFile(file, keep));
  }

  /**
   * 指定タブより右側にあるタブを全て閉じる
   */
  function closeTabsToRight(layoutSide: LayoutSide, from: ContainerElementFile): Promise<void> {
    const tabs = editorStore.tabs[layoutSide];
    const fromIdx = tabs.findIndex((file) => isSameFile(file, from));
    if (fromIdx === -1) return Promise.resolve();

    const rightFiles = new Set(tabs.slice(fromIdx + 1));
    return closeTabsWhere(layoutSide, (file) => rightFiles.has(file));
  }

  /**
   * 保存済み（未保存の変更が無い）タブを全て閉じる
   *
   * 実行時は全タブへ API を投げて状態を確認してから、対象を一括クローズする。
   * 途中でユーザーがキャンセルした場合、以降のタブの処理は中止される。
   */
  async function closeSavedTabs(layoutSide: LayoutSide): Promise<void> {
    const tabs = editorStore.tabs[layoutSide];
    const savedChecks = await Promise.all(
      tabs.map(async (file) => {
        const unsavedRes = await api.hasUnsavedChangesByFile(file);
        // 判定できない項目は未保存と見なしてクローズ対象から外す
        return unsavedRes.ok && !unsavedRes.data;
      }),
    );
    const savedFiles = new Set(tabs.filter((_, idx) => savedChecks[idx]));
    await closeTabsWhere(layoutSide, (file) => savedFiles.has(file));
  }

  return { closeTabWithConfirm, closeOtherTabs, closeTabsToRight, closeSavedTabs };
}
