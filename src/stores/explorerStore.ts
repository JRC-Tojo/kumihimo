import { defineStore, acceptHMRUpdate } from 'pinia';
import type { ContainerElement, ContainerID } from 'src/models/container';

/**
 * ツリー上の要素を一意に表すキー（コンテナIDまで含めて別コンテナの同名パスを区別する）
 */
export function explorerKey(containerID: ContainerID, path: string): string {
  return `${containerID}|${path}`;
}

export type ClipboardMode = 'copy' | 'cut';

export interface ExplorerClipboard {
  mode: ClipboardMode;
  items: ContainerElement[];
}

export const useExplorerStore = defineStore('explorer', {
  state: () => ({
    // 展開中のコンテナ（コンテナID）
    expandedContainers: new Set<ContainerID>(),
    // 展開中のフォルダ（explorerKey）
    expandedFolders: new Set<string>(),
    // 選択中の要素（explorerKey、複数選択対応）
    selectedKeys: new Set<string>(),
    // Shift範囲選択の起点
    lastSelectedKey: null as string | null,
    // 切り取り/コピーで保持している要素
    clipboard: null as ExplorerClipboard | null,
  }),

  getters: {
    isContainerExpanded(state) {
      return (cId: ContainerID): boolean => state.expandedContainers.has(cId);
    },
    isFolderExpanded(state) {
      return (cId: ContainerID, path: string): boolean =>
        state.expandedFolders.has(explorerKey(cId, path));
    },
    isSelected(state) {
      return (cId: ContainerID, path: string): boolean =>
        state.selectedKeys.has(explorerKey(cId, path));
    },
  },

  actions: {
    toggleContainer(cId: ContainerID): void {
      if (this.expandedContainers.has(cId)) {
        this.expandedContainers.delete(cId);
      } else {
        this.expandedContainers.add(cId);
      }
    },

    toggleFolder(cId: ContainerID, path: string): void {
      const key = explorerKey(cId, path);
      if (this.expandedFolders.has(key)) {
        this.expandedFolders.delete(key);
      } else {
        this.expandedFolders.add(key);
      }
    },

    /**
     * 単一選択（他の選択状態はクリアする）
     */
    select(cId: ContainerID, path: string): void {
      const key = explorerKey(cId, path);
      this.selectedKeys = new Set([key]);
      this.lastSelectedKey = key;
    },

    /**
     * 選択のトグル（Ctrl/Cmdクリック用）
     */
    toggleSelect(cId: ContainerID, path: string): void {
      const key = explorerKey(cId, path);
      const next = new Set(this.selectedKeys);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      this.selectedKeys = next;
      this.lastSelectedKey = key;
    },

    clearSelection(): void {
      this.selectedKeys = new Set();
      this.lastSelectedKey = null;
    },

    /**
     * Shift+クリックによる範囲選択
     *
     * @param visibleKeys 現在画面に表示されている行のキー一覧（表示順）。
     *   ツリーの展開状態次第で対象範囲が変わるため、呼び出し側（UIコンポーネント）から渡す
     */
    selectRange(visibleKeys: string[], targetKey: string): void {
      const anchor = this.lastSelectedKey ?? targetKey;
      const anchorIdx = visibleKeys.indexOf(anchor);
      const targetIdx = visibleKeys.indexOf(targetKey);
      if (anchorIdx === -1 || targetIdx === -1) {
        this.selectedKeys = new Set([targetKey]);
        return;
      }

      const [start, end] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
      this.selectedKeys = new Set(visibleKeys.slice(start, end + 1));
    },

    /**
     * 削除された要素のキー・パス参照を、選択・展開・クリップボード状態から取り除く
     */
    forgetPaths(containerID: ContainerID, paths: string[]): void {
      if (paths.length === 0) return;
      const keysToForget = new Set(paths.map((p) => explorerKey(containerID, p)));

      const forgetSet = (keys: Set<string>): Set<string> =>
        new Set([...keys].filter((key) => !keysToForget.has(key)));

      this.expandedFolders = forgetSet(this.expandedFolders);
      this.selectedKeys = forgetSet(this.selectedKeys);

      if (this.lastSelectedKey !== null && keysToForget.has(this.lastSelectedKey)) {
        this.lastSelectedKey = null;
      }

      if (this.clipboard !== null) {
        const items = this.clipboard.items.filter(
          (item) => !(item.containerID === containerID && paths.includes(item.path)),
        );
        this.clipboard = items.length > 0 ? { ...this.clipboard, items } : null;
      }
    },

    setClipboard(mode: ClipboardMode, items: ContainerElement[]): void {
      this.clipboard = { mode, items };
    },

    clearClipboard(): void {
      this.clipboard = null;
    },

    /**
     * リネーム・移動された要素のキー・パス参照を追従させる
     *
     * `expandedFolders`/`selectedKeys`/`lastSelectedKey`は`explorerKey`（containerID|path）で
     * 管理しているため、リネーム後もキーを付け替えないと展開・選択状態が失われてしまう。
     * `clipboard`はContainerElement自体を保持しているため、pathを直接書き換える
     */
    remapKeys(containerID: ContainerID, pathMap: Record<string, string>): void {
      const remapSet = (keys: Set<string>): Set<string> => {
        const updated = new Set<string>();
        keys.forEach((key) => {
          const [cID, path] = key.split('|');
          if (cID === containerID && path !== undefined && pathMap[path] !== undefined) {
            updated.add(explorerKey(containerID, pathMap[path]));
          } else {
            updated.add(key);
          }
        });
        return updated;
      };

      this.expandedFolders = remapSet(this.expandedFolders);
      this.selectedKeys = remapSet(this.selectedKeys);

      if (this.lastSelectedKey !== null) {
        const [cID, path] = this.lastSelectedKey.split('|');
        if (cID === containerID && path !== undefined && pathMap[path] !== undefined) {
          this.lastSelectedKey = explorerKey(containerID, pathMap[path]);
        }
      }

      if (this.clipboard !== null) {
        this.clipboard = {
          ...this.clipboard,
          items: this.clipboard.items.map((item) => {
            const newPath = item.containerID === containerID ? pathMap[item.path] : undefined;
            return newPath !== undefined ? { ...item, path: newPath } : item;
          }),
        };
      }
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useExplorerStore, import.meta.hot));
}
