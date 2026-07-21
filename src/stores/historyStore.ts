import { defineStore, acceptHMRUpdate } from 'pinia';
import { fileKey, type FileIdentity } from 'src/utils/document/fileKey';

/**
 * 取り消し可能な1操作を表すコマンド
 *
 * アノテーションに限らず、将来のページ送り履歴や他文書種別にも転用できるよう、
 * 対象の種類に依存しない汎用的な形にする。関数参照を保持するためZodでは定義しない
 * （共有しない関数ローカルのinterfaceとしてZod管理の対象外とする）
 */
export interface HistoryCommand {
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
}

interface HistoryBucket {
  undoStack: HistoryCommand[];
  redoStack: HistoryCommand[];
}

/** 1タブあたりに保持する履歴の最大件数（無制限に増え続けるのを防ぐ） */
const MAX_STACK_SIZE = 100;

function emptyBuckets(): Record<string, HistoryBucket> {
  return {};
}

export const useHistoryStore = defineStore('history', {
  state: () => ({
    // タブ（containerID+path）ごとのUndo/Redoスタック
    buckets: emptyBuckets(),
  }),

  getters: {
    /**
     * 指定タブに取り消せる操作が残っているか
     */
    canUndo(state): (file: FileIdentity) => boolean {
      return (file: FileIdentity) => (state.buckets[fileKey(file)]?.undoStack.length ?? 0) > 0;
    },

    /**
     * 指定タブにやり直せる操作が残っているか
     */
    canRedo(state): (file: FileIdentity) => boolean {
      return (file: FileIdentity) => (state.buckets[fileKey(file)]?.redoStack.length ?? 0) > 0;
    },
  },

  actions: {
    /**
     * 指定タブのバケツを取得する（無ければ新規作成する）
     */
    ensureBucket(file: FileIdentity): HistoryBucket {
      const key = fileKey(file);
      const existing = this.buckets[key];
      if (existing) return existing;

      const created: HistoryBucket = { undoStack: [], redoStack: [] };
      this.buckets[key] = created;
      return created;
    },

    /**
     * 新しい操作を指定タブの履歴に積む
     *
     * 新規の操作を積むと、それ以降のRedo系列は無効になるため、redoStackは空にする
     */
    push(file: FileIdentity, command: HistoryCommand): void {
      const bucket = this.ensureBucket(file);
      bucket.undoStack.push(command);
      if (bucket.undoStack.length > MAX_STACK_SIZE) bucket.undoStack.shift();
      bucket.redoStack = [];
    },

    /**
     * 指定タブの直前の操作を取り消す
     */
    async undo(file: FileIdentity): Promise<void> {
      const bucket = this.buckets[fileKey(file)];
      if (!bucket) return;
      const command = bucket.undoStack.pop();
      if (!command) return;

      await command.undo();
      bucket.redoStack.push(command);
    },

    /**
     * 指定タブの直前に取り消した操作をやり直す
     */
    async redo(file: FileIdentity): Promise<void> {
      const bucket = this.buckets[fileKey(file)];
      if (!bucket) return;
      const command = bucket.redoStack.pop();
      if (!command) return;

      await command.redo();
      bucket.undoStack.push(command);
    },

    /**
     * 指定タブの履歴を破棄する（タブが完全に閉じられた時にのみ呼ぶこと。
     * ペイン内でのタブ切り替え・DocumentTabViewの再マウントでは呼ばない）
     */
    clear(file: FileIdentity): void {
      delete this.buckets[fileKey(file)];
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useHistoryStore, import.meta.hot));
}
