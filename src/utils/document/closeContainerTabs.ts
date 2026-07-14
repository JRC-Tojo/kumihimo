/**
 * コンテナを閉じる際、そのコンテナに属する開いているタブをすべて閉じるための補助関数
 *
 * `api.unloadContainer`はコンテナの読み込み対象一覧からの除外のみを行い、
 * 各ペインが開いているタブ（Piniaストア側の状態）までは追従しないため、
 * 呼び出し側（ExpContainer.vue）でこれらの関数を使ってタブを後始末する
 */
import type { ContainerElementFile, ContainerID } from 'src/models/container';
import { useEditorStore } from 'src/stores/editorStore';

const SIDES = ['ul', 'ur', 'll', 'lr'] as const;

/**
 * 指定コンテナに属する、現在開いているタブ一覧を全ペインから集める
 *
 * 同一ファイルが複数ペインで開かれている場合は1つにまとめて返す
 */
export function collectOpenTabsForContainer(containerID: ContainerID): ContainerElementFile[] {
  const editorStore = useEditorStore();
  const all = SIDES.flatMap((side) =>
    editorStore.tabs[side].filter((tab) => tab.containerID === containerID),
  );
  return Array.from(new Map(all.map((file) => [file.path, file])).values());
}

/**
 * 指定コンテナに属するタブをすべて閉じる（全ペイン対象）
 */
export function closeTabsForContainer(containerID: ContainerID, files: ContainerElementFile[]): void {
  if (files.length === 0) return;
  useEditorStore().closeTabsForPaths(
    containerID,
    files.map((file) => file.path),
  );
}
