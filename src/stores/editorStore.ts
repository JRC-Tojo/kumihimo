/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import { defineStore, acceptHMRUpdate } from 'pinia';
import type { ContainerElement, ContainerElementFile } from 'src/models/container';
import type { DrawingAnnotationStyle, DrawingAnnotationType, IDocTool } from 'src/models/docPage';
import type { AnnotationID } from 'src/models/document/pdf';
import type { RelationalRule } from 'src/models/relational/fileSchema';

export type PointerType = DrawingAnnotationType | 'hand' | 'pointer';
export type Layouts<T> = { ul: T; ur: T; ll: T; lr: T };
export type LayoutSide = keyof Layouts<never>;
export type TileMode = 'single' | 'dubble' | 'grid';

export type RelationalType = RelationalRule['type'] | undefined;

/**
 * デフォルトのアノテーションスタイル
 */
const DEFAULT_ANNOTATION_STYLE: DrawingAnnotationStyle = {
  type: 'line',
  strokeColor: '#000000',
  strokeWidth: 2,
  strokeType: 'solid',
  strokeOpacity: 1,
};

export const useEditorStore = defineStore('editor', {
  state: () => ({
    mainTools: [] as IDocTool[],
    subTools: [] as IDocTool[],
    currentTools: 'hand' as PointerType,
    currentAnnotationStyle: DEFAULT_ANNOTATION_STYLE as DrawingAnnotationStyle,
    isStoreInitialized: false,

    // ドキュメントレイアウトの状態
    tabs: { ul: [], ur: [], ll: [], lr: [] } as Layouts<ContainerElementFile[]>,
    pinedTabPaths: {
      ul: new Set<string>(),
      ur: new Set<string>(),
      ll: new Set<string>(),
      lr: new Set<string>(),
    } as Layouts<Set<string>>,
    activeTabPaths: { ul: null, ur: null, ll: null, lr: null } as Layouts<string | null>,
    activeSide: 'ul' as LayoutSide,

    // アノテーションの表示状態
    visibleAnnotations: true,
    autoSaveAnnotations: false,

    // サイドパネルの表示状態
    leftDrawerModel: false,
    rightDrawerModel: false,

    // タブ表示のタイルモード
    tileMode: 'single' as TileMode,

    // 関係性機能の状態
    relationalMode: undefined as RelationalType,
    // 関係性登録で基準となるアノテーションID（対になるアノテーションの待機中のみ設定される）
    relationalPendingId: undefined as AnnotationID | undefined,
    // 待機中の基準アノテーションが属するファイル（複数タブ表示時に待機の発生元を判別するために保持）
    relationalPendingFile: undefined as ContainerElementFile | undefined,
  }),

  actions: {
    /**
     * 関係性登録モードを終了する（待機中の状態も解除する）
     */
    cancelRelationalMode(): void {
      this.relationalMode = undefined;
      this.relationalPendingId = undefined;
      this.relationalPendingFile = undefined;
    },

    /**
     * 対になるアノテーションの待機状態を開始する
     */
    startRelationalPending(annotId: AnnotationID, file: ContainerElementFile): void {
      this.relationalPendingId = annotId;
      this.relationalPendingFile = file;
    },

    /**
     * 対になるアノテーションの待機状態を解除する（関係性登録モード自体は維持する）
     */
    cancelRelationalPending(): void {
      this.relationalPendingId = undefined;
      this.relationalPendingFile = undefined;
    },

    /**
     * ストアの初期化（初回のみ実行）
     */
    initStore(mainTools: IDocTool[], currentTools: PointerType = 'hand'): void {
      // 既に初期化済みの場合はスキップ
      if (this.isStoreInitialized) return;

      this.mainTools = mainTools;
      this.currentTools = currentTools;
      this.isStoreInitialized = true;
    },

    /**
     * アクティブなタブを取得
     */
    getActiveTab(side: LayoutSide): ContainerElementFile | null {
      if (!this.activeTabPaths[side]) return null;
      return this.tabs[side].find((tab) => tab.path === this.activeTabPaths[side]) ?? null;
    },

    /**
     * 選択された文書のタブを開く
     */
    openTab(elem: ContainerElement): void {
      if (elem.type !== 'File') return;

      const isAlreadyOpened = this.tabs[this.activeSide].some((tab) => tab.path === elem.path);
      if (!isAlreadyOpened) {
        this.tabs[this.activeSide].push(elem);
      }
      this.selectTab(elem, this.activeSide, true);
    },

    /**
     * タブを選択する
     * @param isFocus: Trueの時にactiveSideを更新する
     */
    selectTab(elem: ContainerElement, layoutSide: LayoutSide, isFocus: boolean): void {
      this.activeTabPaths[layoutSide] = elem.path;
      if (isFocus) this.activeSide = layoutSide;
    },

    /**
     * タブを閉じる
     */
    closeTab(elem: ContainerElement, layoutSide: LayoutSide): void {
      const targetIdx = this.tabs[layoutSide].findIndex((tab) => tab.path === elem.path);
      if (targetIdx === -1) return;

      // 開いているタブ一覧から除外
      this.tabs[layoutSide].splice(targetIdx, 1);
      this.pinedTabPaths[layoutSide].delete(elem.path);

      // アクティブタブが削除された場合は直前のタブをアクティブに
      if (this.activeTabPaths[layoutSide] === elem.path) {
        const nextIdx = Math.max(0, targetIdx - 1);
        this.activeTabPaths[layoutSide] = this.tabs[layoutSide][nextIdx]?.path ?? null;
      }
    },

    /**
     * タブをピンする
     */
    pinTab(elem: ContainerElement, layoutSide: LayoutSide): void {
      this.pinedTabPaths[layoutSide].add(elem.path);
    },

    /**
     * タブのピンを解除する
     */
    unPinTab(elem: ContainerElement, layoutSide: LayoutSide): void {
      this.pinedTabPaths[layoutSide].delete(elem.path);
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useEditorStore, import.meta.hot));
}
