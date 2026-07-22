/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import { defineStore, acceptHMRUpdate } from 'pinia';
import { nextTick } from 'vue';
import type { ContainerElement, ContainerElementFile, ContainerID } from 'src/models/container';
import type { DrawingAnnotationStyle, DrawingAnnotationType, IDocTool } from 'src/models/docPage';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import type { RelationalRule } from 'src/models/relational/fileSchema';
import type { LayerOrderAction } from 'src/utils/document/annotationOrder';
import { Path } from 'src/utils/binary/path';
import { useHistoryStore } from './historyStore';

export type PointerType = DrawingAnnotationType | 'hand' | 'pointer';
const sides = ['ul', 'ur', 'll', 'lr'] as const;
export type LayoutSide = (typeof sides)[number];
export type Layouts<T> = { [side in LayoutSide]: T };
export type TileMode = 'single' | 'dubble' | 'grid';

export type RelationalType = RelationalRule['type'] | undefined;

/**
 * タブの同一性判定に用いるキー
 *
 * pathだけでは別コンテナの同一パスファイルを区別できないため、containerIDと組み合わせる。
 * pathはPathオブジェクトで正規化してから連結する（区切り文字表記の揺れによる
 * 同一ファイルの不一致判定を防ぐ）
 */
function tabKey(f: { containerID: ContainerID; path: string }): string {
  return `${f.containerID}|${new Path(f.path).path}`;
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
    leftHeaderTools: [] as IDocTool[],
    rightHeaderTools: [] as IDocTool[],
    mainTools: [] as IDocTool[],
    subTools: [] as IDocTool[],
    currentTools: 'hand' as PointerType,
    currentAnnotationStyle: DEFAULT_ANNOTATION_STYLE as DrawingAnnotationStyle,
    isStoreInitialized: false,

    // アノテーション種別のMainToolが選択中かどうか（プリセットバー・スタイルパネルの表示条件に使う）
    activeAnnotationType: undefined as DrawingAnnotationType | undefined,
    // アクティブなペインで現在選択中のアノテーション（スタイルパネルの選択編集モードで使う）。
    // 選択状態自体は各DocumentTabView（ペインごと）が持つため、layerOrderAction等と同じ
    // 「意図・状態をeditorStoreに橋渡しする」パターンでここに反映させる
    activeSelection: undefined as
      { file: ContainerElementFile; annotations: AnnotationStyle[] } | undefined,

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

    // 削除によるタブクローズの対象（tabKey）。DocumentTabView等がonBeforeUnmount時に
    // 「削除によるクローズか、通常のタブクローズか」を判別するための一時的なマーカー
    deletingTabKeys: new Set<string>(),

    // アノテーションのアプリ内クリップボード（OSクリップボードは使わない。explorerStore.clipboardと同じ思想）
    annotationClipboard: null as AnnotationStyle[] | null,
    // 連続ペースト時に少しずつ位置をずらすためのカウンタ。コピーのたびにリセットする
    annotationClipboardPasteCount: 0,

    // 重ね順操作の意図フラグ（relationalModeと同じパターン）。
    // ツールバー（MainTools/SubTools）は選択状態を持たないため、意図だけをここにセットし、
    // 実際の処理は選択状態を持つDocumentTabView側でwatchして実行する
    layerOrderAction: undefined as LayerOrderAction | undefined,
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
     * アクティブなペインの選択中アノテーションをスタイルパネル用に反映する
     */
    setActiveSelection(file: ContainerElementFile, annotations: AnnotationStyle[]): void {
      this.activeSelection = annotations.length > 0 ? { file, annotations } : undefined;
    },

    /**
     * スタイルパネル用の選択状態を解除する
     */
    clearActiveSelection(): void {
      this.activeSelection = undefined;
    },

    /**
     * ストアの初期化（初回のみ実行）
     */
    initStore(leftHeaderTools: IDocTool[], rightHeaderTools: IDocTool[]): void {
      // 既に初期化済みの場合はスキップ
      if (this.isStoreInitialized) return;

      this.leftHeaderTools = leftHeaderTools;
      this.rightHeaderTools = rightHeaderTools;
      this.isStoreInitialized = true;
    },

    /**
     * 文書操作用のメインツールを配置
     */
    setMainTools(mainTools: IDocTool[], currentTools: PointerType = 'hand'): void {
      this.mainTools = mainTools;
      this.currentTools = currentTools;
    },

    /**
     * アクティブなタブを取得
     */
    getActiveTab(side: LayoutSide): ContainerElementFile | null {
      if (!this.activeTabPaths[side]) return null;
      return this.tabs[side].find((tab) => tabKey(tab) === this.activeTabPaths[side]) ?? null;
    },

    /**
     * 指定コンテナに属する、現在開いているタブ一覧を全ペインから集める
     */
    getTabsForContainer(cID: ContainerID): ContainerElementFile[] {
      const all = sides.flatMap((side) => this.tabs[side].filter((tab) => tab.containerID === cID));
      return Array.from(new Map(all.map((file) => [file.path, file])).values());
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
     * 指定した要素が、いずれかのペインでまだ開かれているかどうかを判定する
     *
     * 同一ファイルが複数ペインに同時に開かれている場合、履歴（historyStore）は
     * containerID+path単位で共有しているため、全ペインから閉じられるまではクリアしてはならない
     */
    isTabOpenAnywhere(elem: { containerID: ContainerID; path: string }): boolean {
      return sides.some((side) => this.tabs[side].some((tab) => tabKey(tab) === tabKey(elem)));
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

      // 他のペインにも開かれていなければ、このタブのUndo/Redo履歴を破棄する
      if (!this.isTabOpenAnywhere(elem)) {
        useHistoryStore().clear(elem);
      }
    },

    /**
     * 指定パスのファイルタブを全ペインから閉じる（ファイル削除時に使う）
     */
    closeTabsForPaths(containerID: ContainerID, paths: string[]): void {
      if (paths.length === 0) return;
      const pathSet = new Set(paths);

      sides.forEach((side) => {
        const removedKeys = this.tabs[side]
          .filter((tab) => tab.containerID === containerID && pathSet.has(tab.path))
          .map((tab) => tabKey(tab));
        if (removedKeys.length === 0) return;

        this.tabs[side] = this.tabs[side].filter(
          (tab) => !(tab.containerID === containerID && pathSet.has(tab.path)),
        );
        removedKeys.forEach((key) => this.pinedTabPaths[side].delete(key));

        const activeKey = this.activeTabPaths[side];
        if (activeKey !== null && removedKeys.includes(activeKey)) {
          const lastTab = this.tabs[side][this.tabs[side].length - 1];
          this.activeTabPaths[side] = lastTab ? tabKey(lastTab) : null;
        }
      });

      // このループでpathsは全ペインから無条件に取り除かれているため、
      // ループ後は必ずどのペインにも存在しない状態になっている
      const historyStore = useHistoryStore();
      paths.forEach((path) => historyStore.clear({ containerID, path }));
    },

    /**
     * ファイル削除に伴い、指定パスのファイルタブを全ペインから閉じる
     *
     * `closeTabsForPaths`と異なり、閉じている間`deletingTabKeys`にマークを付けることで、
     * アンマウントされるDocumentTabView等が「削除によるクローズ」を判別し、
     * 削除済みファイルへの自動保存を避けられるようにする
     */
    async closeTabsForDeletedPaths(containerID: ContainerID, paths: string[]): Promise<void> {
      if (paths.length === 0) return;
      const keys = paths.map((path) => tabKey({ containerID, path }));
      keys.forEach((key) => this.deletingTabKeys.add(key));

      this.closeTabsForPaths(containerID, paths);

      // 削除によるアンマウント処理（onBeforeUnmount）が完了するまでマークを残しておく
      await nextTick();
      keys.forEach((key) => this.deletingTabKeys.delete(key));
    },

    closeTabsForContainer(cID: ContainerID, files: ContainerElement[]): void {
      if (files.length === 0) return;
      this.closeTabsForPaths(
        cID,
        files.map((file) => file.path),
      );
    },

    /**
     * 指定ファイルが、削除に伴うタブクローズの対象になっているかどうかを判定する
     */
    isPendingDeletion(containerID: ContainerID, path: string): boolean {
      return this.deletingTabKeys.has(tabKey({ containerID, path }));
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
     * 新パスでの再マウント（＝アノテーションの正しい再購読）が自動的に発生する。
     * 履歴（historyStore）はcontainerID+path単位のバケツで管理しているため、
     * タブのpath書き換えに合わせてバケツ自体も新キーへ移し替える
     */
    remapPaths(containerID: ContainerID, pathMap: Record<string, string>): void {
      const historyStore = useHistoryStore();

      sides.forEach((side) => {
        this.tabs[side].forEach((tab) => {
          if (tab.containerID !== containerID) return;
          const newPath = pathMap[tab.path];
          if (newPath === undefined) return;
          historyStore.migrate({ containerID, path: tab.path }, { containerID, path: newPath });
          tab.path = newPath;
        });

        const activeKey = this.activeTabPaths[side];
        if (activeKey !== null && activeKey !== SETTINGS_TAB_KEY) {
          const prefix = `${containerID}|`;
          const path = activeKey.startsWith(prefix) ? activeKey.slice(prefix.length) : undefined;
          if (path !== undefined && pathMap[path] !== undefined) {
            this.activeTabPaths[side] = tabKey({ containerID, path: pathMap[path] });
          }
        }

        const remappedPinned = new Set<string>();
        this.pinedTabPaths[side].forEach((pinnedKey) => {
          const prefix = `${containerID}|`;
          const path = pinnedKey.startsWith(prefix) ? pinnedKey.slice(prefix.length) : undefined;
          if (path !== undefined && pathMap[path] !== undefined) {
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
     * アノテーションのアプリ内クリップボードにコピーする（ペースト回数カウンタもリセットする）
     */
    setAnnotationClipboard(items: AnnotationStyle[]): void {
      this.annotationClipboard = items;
      this.annotationClipboardPasteCount = 0;
    },

    /**
     * アノテーションのアプリ内クリップボードを空にする
     */
    clearAnnotationClipboard(): void {
      this.annotationClipboard = null;
      this.annotationClipboardPasteCount = 0;
    },

    /**
     * ペースト回数カウンタをインクリメントする（連続ペースト時に貼り付け位置を少しずつずらすため）
     */
    incrementClipboardPasteCount(): void {
      this.annotationClipboardPasteCount += 1;
    },

    /**
     * 重ね順操作（最前面/前面/背面/最背面）の意図をセットする
     *
     * 実際の対象（選択中の注釈）解決と実行は、選択状態を持つDocumentTabView側のwatchで行う
     */
    requestLayerOrder(action: LayerOrderAction): void {
      this.layerOrderAction = action;
    },

    /**
     * 重ね順操作の意図フラグを解除する
     */
    clearLayerOrderAction(): void {
      this.layerOrderAction = undefined;
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
