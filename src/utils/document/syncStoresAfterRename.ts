/**
 * リネーム・移動後に、フロントエンド側の各Piniaストアが保持するファイルパス参照を追従させる
 *
 * `api.renamePath`/`api.moveElement`はDBサイド（アノテーション・関係性・キャッシュファイル）の
 * パス追従までは行うが、Piniaストア（タブ・関係性検証キャッシュ・Explorerの選択/展開状態）は
 * フロントエンドのみの状態のためバックエンド層では追従できない。呼び出し側でこの関数を呼ぶことで、
 * タブを開き直さなくても移動・リネーム後の表示が正しく続行できるようにする
 */
import type { ContainerID, RenamedEntry } from 'src/models/container';
import { useEditorStore } from 'src/stores/editorStore';
import { useRelationalStore } from 'src/stores/relationalStore';
import { useGroupStore } from 'src/stores/groupStore';
import { useExplorerStore } from 'src/stores/explorerStore';

export function syncStoresAfterRename(containerID: ContainerID, renamed: RenamedEntry[]): void {
  if (renamed.length === 0) return;

  const pathMap: Record<string, string> = {};
  renamed.forEach((r) => {
    pathMap[r.oldPath] = r.element.path;
  });

  useEditorStore().remapPaths(containerID, pathMap);
  useRelationalStore().remapFileKeys(containerID, pathMap);
  useGroupStore().remapFileKeys(containerID, pathMap);
  useExplorerStore().remapKeys(containerID, pathMap);
}
