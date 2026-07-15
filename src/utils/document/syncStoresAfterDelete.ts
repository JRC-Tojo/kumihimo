/**
 * 削除されたファイル・フォルダについて、フロントエンド側の各Piniaストアが保持する
 * パス参照を後始末する
 *
 * `api.deleteFile`/`api.deleteFolder`は実データ・共有キャッシュの削除までは行うが、
 * Piniaストア（タブ・Explorerの選択/展開/クリップボード状態）はフロントエンドのみの状態のため
 * バックエンド層では追従できない。呼び出し側でこの関数を呼ぶことで、削除済みファイルを
 * 開いたままのタブや、削除済み要素を指したままの選択状態が残らないようにする
 */
import type { ContainerElement, ContainerID } from 'src/models/container';
import { useEditorStore } from 'src/stores/editorStore';
import { useExplorerStore } from 'src/stores/explorerStore';

export function syncStoresAfterDelete(containerID: ContainerID, deleted: ContainerElement[]): void {
  if (deleted.length === 0) return;

  const filePaths = deleted.filter((e) => e.type === 'File').map((e) => e.path);
  const allPaths = deleted.map((e) => e.path);

  void useEditorStore().closeTabsForDeletedPaths(containerID, filePaths);
  useExplorerStore().forgetPaths(containerID, allPaths);
}
