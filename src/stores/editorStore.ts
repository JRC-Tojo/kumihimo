/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import { defineStore, acceptHMRUpdate } from 'pinia';
import type { ContainerElement, ContainerElementFile, ContainerID } from 'src/models/container';
import type { DrawingAnnotationStyle, DrawingAnnotationType, IDocTool } from 'src/models/docPage';
import type { AnnotationID } from 'src/models/document/pdf';
import type { RelationalRule } from 'src/models/relational/fileSchema';

export type PointerType = DrawingAnnotationType | 'hand' | 'pointer';
export type Layouts<T> = { ul: T; ur: T; ll: T; lr: T };
export type LayoutSide = keyof Layouts<never>;
export type TileMode = 'single' | 'dubble' | 'grid';

export type RelationalType = RelationalRule['type'] | undefined;

/**
 * タブの同一性判定に用いるキー
 *
 * pathだけでは別コンテナの同一パスファイルを区別できないため、containerIDと組み合わせる
 */
function tabKey(f: { containerID: ContainerID; path: string }): string {
  return `${f.containerID}|${f.path}`;
}

/**
 * 設定タブを表す特別なアクティブタブキー（ContainerElementFileのtabKeyとは絶対に衝突しない形式）
 */
export const SETTINGS_TAB_KEY = '__settings__';

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
    // 各ペインで設定タブが開かれているか（設定はContainerElementFileではないため別管理する）
    settingsOpenSides: { ul: false, ur: false, ll: false, lr: false } as Layouts<boolean>,

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
      return this.tabs[side].find((tab) => tabKey(tab) === this.activeTabPaths[side]) ?? null;
    },

    /**
     * 選択された文書のタブを開く
     *
     * containerIDまで含めて同一性判定するため、別コンテナの同名パスファイルも正しく別タブとして開かれる
     */
    openTab(elem: ContainerElement): void {
      if (elem.type !== 'File') return;

      const isAlreadyOpened = this.tabs[this.activeSide].some(
        (tab) => tabKey(tab) === tabKey(elem),
      );
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
      this.activeTabPaths[layoutSide] = tabKey(elem);
      if (isFocus) this.activeSide = layoutSide;
    },

    /**
     * タブを閉じる
     */
    closeTab(elem: ContainerElement, layoutSide: LayoutSide): void {
      const targetIdx = this.tabs[layoutSide].findIndex((tab) => tabKey(tab) === tabKey(elem));
      if (targetIdx === -1) return;

      // 開いているタブ一覧から除外
      this.tabs[layoutSide].splice(targetIdx, 1);
      this.pinedTabPaths[layoutSide].delete(tabKey(elem));

      // アクティブタブが削除された場合は直前のタブをアクティブに
      if (this.activeTabPaths[layoutSide] === tabKey(elem)) {
        const nextIdx = Math.max(0, targetIdx - 1);
        const nextTab = this.tabs[layoutSide][nextIdx];
        this.activeTabPaths[layoutSide] = nextTab ? tabKey(nextTab) : null;
      }
    },

    /**
     * タブをピンする
     */
    pinTab(elem: ContainerElement, layoutSide: LayoutSide): void {
      this.pinedTabPaths[layoutSide].add(tabKey(elem));
    },

    /**
     * タブのピンを解除する
     */
    unPinTab(elem: ContainerElement, layoutSide: LayoutSide): void {
      this.pinedTabPaths[layoutSide].delete(tabKey(elem));
    },

    /**
     * 設定タブを開く（現在アクティブなペインに、文書タブと同様の見た目で開かれる）
     */
    openSettingsTab(): void {
      this.settingsOpenSides[this.activeSide] = true;
      this.activeTabPaths[this.activeSide] = SETTINGS_TAB_KEY;
    },

    /**
     * 設定タブを選択する
     */
    selectSettingsTab(layoutSide: LayoutSide, isFocus: boolean): void {
      this.activeTabPaths[layoutSide] = SETTINGS_TAB_KEY;
      if (isFocus) this.activeSide = layoutSide;
    },

    /**
     * リネーム・移動されたファイルのパス参照を、全ペインのタブ状態に追従させる
     *
     * `tabs`内オブジェクトのpathを直接書き換えることで、これをpropとして参照している
     * DocumentTabView等のコンポーネントキー（containerID+path）が変わり、
     * 新パスでの再マウント（＝アノテーションの正しい再購読）が自動的に発生する
     */
    remapPaths(containerID: ContainerID, pathMap: Record<string, string>): void {
      (['ul', 'ur', 'll', 'lr'] as const).forEach((side) => {
        this.tabs[side].forEach((tab) => {
          if (tab.containerID !== containerID) return;
          const newPath = pathMap[tab.path];
          if (newPath !== undefined) tab.path = newPath;
        });

        const activeKey = this.activeTabPaths[side];
        if (activeKey !== null && activeKey !== SETTINGS_TAB_KEY) {
          const [cID, path] = activeKey.split('|');
          if (cID === containerID && path !== undefined && pathMap[path] !== undefined) {
            this.activeTabPaths[side] = tabKey({ containerID, path: pathMap[path] });
          }
        }

        const remappedPinned = new Set<string>();
        this.pinedTabPaths[side].forEach((pinnedKey) => {
          const [cID, path] = pinnedKey.split('|');
          if (cID === containerID && path !== undefined && pathMap[path] !== undefined) {
            remappedPinned.add(tabKey({ containerID, path: pathMap[path] }));
          } else {
            remappedPinned.add(pinnedKey);
          }
        });
        this.pinedTabPaths[side] = remappedPinned;
      });

      const pendingFile = this.relationalPendingFile;
      if (pendingFile !== undefined && pendingFile.containerID === containerID) {
        const newPendingPath = pathMap[pendingFile.path];
        if (newPendingPath !== undefined) pendingFile.path = newPendingPath;
      }
    },

    /**
     * 設定タブを閉じる
     */
    closeSettingsTab(layoutSide: LayoutSide): void {
      this.settingsOpenSides[layoutSide] = false;

      // アクティブタブが設定タブだった場合は、そのペインの最後の文書タブをアクティブにする
      if (this.activeTabPaths[layoutSide] === SETTINGS_TAB_KEY) {
        const lastTab = this.tabs[layoutSide][this.tabs[layoutSide].length - 1];
        this.activeTabPaths[layoutSide] = lastTab ? tabKey(lastTab) : null;
      }
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useEditorStore, import.meta.hot));
}
