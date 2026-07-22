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
    // undo/redoが実行中のタブキー集合（多重実行防止用）
    busyKeys: new Set<string>(),
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

    /**
     * 指定タブでundo/redoが実行中かどうか（多重実行によるレース防止・ボタン活性判定に使う）
     */
    isBusy(state): (file: FileIdentity) => boolean {
      return (file: FileIdentity) => state.busyKeys.has(fileKey(file));
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
     *
     * 同一タブに対する多重呼び出し（キーリピート・連打）はbusyKeysで無視し、
     * relationalStoreのキャッシュ更新順序が崩れないようにする。command.undo()が
     * 失敗した場合は、スタックから失った状態にならないようundoStackへ戻す
     */
    async undo(file: FileIdentity): Promise<void> {
      const key = fileKey(file);
      if (this.busyKeys.has(key)) return;

      const bucket = this.buckets[key];
      if (!bucket) return;
      const command = bucket.undoStack.pop();
      if (!command) return;

      this.busyKeys.add(key);
      try {
        await command.undo();
        bucket.redoStack.push(command);
      } catch (e) {
        bucket.undoStack.push(command);
        console.error(e);
      } finally {
        this.busyKeys.delete(key);
      }
    },

    /**
     * 指定タブの直前に取り消した操作をやり直す（多重実行防止・失敗時のスタック復元はundoと同様）
     */
    async redo(file: FileIdentity): Promise<void> {
      const key = fileKey(file);
      if (this.busyKeys.has(key)) return;

      const bucket = this.buckets[key];
      if (!bucket) return;
      const command = bucket.redoStack.pop();
      if (!command) return;

      this.busyKeys.add(key);
      try {
        await command.redo();
        bucket.undoStack.push(command);
      } catch (e) {
        bucket.redoStack.push(command);
        console.error(e);
      } finally {
        this.busyKeys.delete(key);
      }
    },

    /**
     * 指定タブの履歴を破棄する（タブが完全に閉じられた時にのみ呼ぶこと。
     * ペイン内でのタブ切り替え・DocumentTabViewの再マウントでは呼ばない）
     */
    clear(file: FileIdentity): void {
      delete this.buckets[fileKey(file)];
    },

    /**
     * ファイルのリネーム・移動に伴い、旧パスの履歴バケツを新パスのキーへ移し替える
     *
     * 移動先に既存のバケツがある場合（同一パスへの統合等、通常起こり得ないケース）は
     * データ不整合を避けるため移し替えを行わず、旧バケツを破棄するだけに留める
     */
    migrate(oldFile: FileIdentity, newFile: FileIdentity): void {
      const oldKey = fileKey(oldFile);
      const newKey = fileKey(newFile);
      if (oldKey === newKey) return;

      const bucket = this.buckets[oldKey];
      if (!bucket) return;

      delete this.buckets[oldKey];
      if (!this.buckets[newKey]) {
        this.buckets[newKey] = bucket;
      }
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useHistoryStore, import.meta.hot));
}
