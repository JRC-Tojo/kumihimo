/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import { defineStore, acceptHMRUpdate } from 'pinia';
import { nextTick } from 'vue';
import type { ContainerElement, ContainerElementFile, ContainerID } from 'src/models/container';
import type {
  DrawingAnnotationStyle,
  DrawingAnnotationType,
  IDocTool,
  ViewMode,
} from 'src/models/docPage';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import type { RelationalRule } from 'src/models/relational/fileSchema';
import type { LayerOrderAction } from 'src/utils/document/annotationOrder';
import { Path } from 'src/utils/binary/path';
import { useHistoryStore } from './historyStore';
import type { PluginID } from 'src/models/plugin/manifest';
import type { PluginInstallSource } from 'src/models/plugin/installation';

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
 * プラグイン所有タブのキー接頭辞（ContainerElementFileのtabKeyや設定タブとは絶対に衝突しない形式）
 */
export const PLUGIN_TAB_PREFIX = '__plugin__:';

/**
 * プラグイン所有タブの参照情報
 *
 * タブは`pluginId`単位で1つだけ開く（実行のたびに増えることはない）。同一タブ内で
 * 何度でも再実行できるようにするため、`runId`はタブの同一性には含めない
 */
export interface PluginTabRef {
  key: string;
  pluginId: PluginID;
  source: PluginInstallSource;
  title: string;
}

function pluginTabKey(pluginId: string, source: PluginInstallSource): string {
  return `${PLUGIN_TAB_PREFIX}${source}:${pluginId}`;
}

/**
 * コンテナ設定タブのキー接頭辞（ContainerElementFileのtabKeyや設定タブ・プラグインタブとは
 * 絶対に衝突しない形式）
 */
export const CONTAINER_SETTINGS_TAB_PREFIX = '__containerSettings__:';

/**
 * コンテナ設定タブの参照情報
 *
 * タブは`containerID`単位で1つだけ開く（pluginTabsと同じ「開く操作のたびには増えず、
 * 既存タブへフォーカスする」パターン）
 */
export interface ContainerSettingsTabRef {
  key: string;
  containerID: ContainerID;
  title: string;
}

function containerSettingsTabKey(containerID: ContainerID): string {
  return `${CONTAINER_SETTINGS_TAB_PREFIX}${containerID}`;
}

/**
 * タブごとに保持する最終表示状態（`editorStore.tabViewStates`の値）
 */
export interface TabViewState {
  lastPage: number;
  viewMode: ViewMode;
  zoomLevel: number;
  scrollLeft: number;
  scrollTop: number;
}

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
    // プリセットをダブルクリックして選んだ場合、描き終えても選択モードへ自動的に戻さず
    // 同じツール・スタイルで連続して描き続けられるようにするフラグ
    stickyDrawMode: false,
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
    // 各ペインで開かれているプラグイン所有タブ（設定タブと同じく、ContainerElementFileではないため別管理する）
    pluginTabs: { ul: [], ur: [], ll: [], lr: [] } as Layouts<PluginTabRef[]>,
    // 各ペインで開かれているコンテナ設定タブ（pluginTabsと同じパターン。containerID単位で1つだけ開く）
    containerSettingsTabs: { ul: [], ur: [], ll: [], lr: [] } as Layouts<ContainerSettingsTabRef[]>,

    // アノテーションの表示状態
    visibleAnnotations: true,
    autoSaveAnnotations: false,

    // タブ表示のタイルモード
    tileMode: 'single' as TileMode,

    // 関係性機能の状態
    relationalMode: undefined as RelationalType,
    // 関係性登録で基準となるアノテーションID（対になるアノテーションの待機中のみ設定される）
    relationalPendingId: undefined as AnnotationID | undefined,
    // 待機中の基準アノテーションが属するファイル（複数タブ表示時に待機の発生元を判別するために保持）
    relationalPendingFile: undefined as ContainerElementFile | undefined,
    // 連続定義モード（関係性ボタンのダブルクリックで開始）。有効な間は1組の関係性が確定して待機が
    // 解除された後、次に選択されたアノテーションを新たな基準として待機状態を自動的に再開する
    // （`RelationalDefineButtons.vue`が選択変化を監視して行う）。
    // ユーザーが明示的にキャンセルするまで（cancelRelationalMode）有効であり続ける
    relationalContinuous: false,
    // 直前に関係性が確定した際の対象アノテーションID。連続定義モードが選択変化を監視する際、
    // 「ペア確定直後に選択され続けているだけの対象」を新たな起点として誤って再利用しないための
    // 目印（対象そのものが変わるまでの一時的なマーカー）
    relationalLastPairedId: undefined as AnnotationID | undefined,

    // 削除によるタブクローズの対象（tabKey）。DocumentTabView等がonBeforeUnmount時に
    // 「削除によるクローズか、通常のタブクローズか」を判別するための一時的なマーカー
    deletingTabKeys: new Set<string>(),

    // タブごとの最終表示状態（タブキー単位で保持し、タブの再選択・再オープン後も復元する）。
    // scrollLeft/scrollTopは`.document-viewer-wrapper`のスクロール位置をそのまま保持したもので、
    // 単一表示モードではズーム時にパンしていた領域、連続表示モードではページ番号を含めた
    // 正確な閲覧位置を表す（ページ番号ベースの近似計算より正確なため、優先して使う）
    tabViewStates: {} as Record<string, TabViewState>,

    // アノテーションのアプリ内クリップボード（OSクリップボードは使わない。explorerStore.clipboardと同じ思想）
    annotationClipboard: null as AnnotationStyle[] | null,

    // タブごとに、カーソルが最後にPDFページ上でホバーしていた位置（文書座標）を記録する
    // （tabViewStatesと同じくtabKey単位で保持する）。選択中のアノテーションが無い状態で
    // ペーストする際、貼り付け位置の基準として使う。タブ単位で分けることで、別タブを
    // ホバーした後にアクティブタブを切り替えてペーストしても、そのタブ自身の座標だけが使われる
    lastPointerDocPos: {} as Record<string, { page: number; x: number; y: number }>,

    // 重ね順操作の意図フラグ（relationalModeと同じパターン）。
    // ツールバー（MainTools/SubTools）は選択状態を持たないため、意図だけをここにセットし、
    // 実際の処理は選択状態を持つDocumentTabView側でwatchして実行する
    layerOrderAction: undefined as LayerOrderAction | undefined,

    // 削除操作の意図フラグ（layerOrderActionと同じパターン）。アノテーション右クリック
    // メニュー（選択状態を持たない）からの削除要求をここに一時的にセットし、
    // 実際の処理は選択状態を持つDocumentTabView側でwatchして実行する
    deleteRequested: false,

    // 関係性ダイアログを開く意図フラグ（deleteRequestedと同じパターン）。アノテーション
    // 右クリックメニューからの要求をここに一時的にセットし、実際にダイアログを開く処理は
    // 選択状態を持つDocumentTabView側でwatchして実行する
    peekRequestedAnnotId: undefined as AnnotationID | undefined,

    // `openTab`にページ番号を指定した際に記録される、遷移先ページの情報。
    // DocumentTabView.vueは自分宛て（containerID・pathが一致）であればこれを消費し、
    // 該当ページへ移動する（対象アノテーションがあれば選択状態にもする）
    pendingTabFocus: undefined as
      | { containerID: ContainerID; path: string; page: number; annotId: AnnotationID | undefined }
      | undefined,

    // ファイル単位のブックマーク更新リビジョン。アノテーション右クリックメニューからの
    // ブックマーク登録のように、ブックマークパネル（activeFileのwatchのみで再読込する）自身が
    // 直接検知できない変更が起きた際に`touchBookmarks`で加算し、パネル側にこれもwatchさせることで
    // 再読込を促す（tabKey単位で管理する点、値そのものに意味は無い点はtabViewStatesと同様）
    bookmarksRevision: {} as Record<string, number>,

    // アクティブなペインの表示モード（単一/連続）。表示モード自体はペインごとのローカルstateのため、
    // layerOrderAction/activeSelectionと同じ「意図・状態をeditorStoreに橋渡しする」パターンで扱う
    activeViewMode: undefined as ViewMode | undefined,
    // メインツールから表示モード変更を要求する意図フラグ。実際の適用はアクティブなペインが行う
    viewModeAction: undefined as ViewMode | undefined,

    // ペインごとに現在表示中のページ番号（DocumentTabView.vueが自身のcurrentPageの変化を
    // ここへ橋渡しする）。Explorerのブックマークパネル等、DocumentTabViewの外側から
    // 「現在表示中のページ」を参照したい場合に使う
    activeTabCurrentPage: { ul: undefined, ur: undefined, ll: undefined, lr: undefined } as Layouts<
      number | undefined
    >,

    // フッター左側に表示するステータスメッセージ。投稿元ごとにキーで管理し、
    // 複数の操作（関係性モードの待機、今後追加されうる他の操作等）が互いのメッセージを
    // 上書きしないようにする
    statusMessages: new Map<string, string>(),

    // 設定タブを開いた際に自動スクロールさせたいセクションID（layerOrderAction等と同じ
    // 「意図をeditorStoreに橋渡しする」パターン。SettingsPage.vue側がこれをwatchして消費する）
    settingsScrollTarget: undefined as string | undefined,
  }),

  getters: {
    /**
     * フッターに表示する最新のステータスメッセージ（複数投稿されている場合は最後に投稿されたもの）
     */
    currentStatusMessage(state): string | undefined {
      return Array.from(state.statusMessages.values()).at(-1);
    },
  },

  actions: {
    /**
     * フッター左側のステータスメッセージ領域にメッセージを投稿する。
     * keyは投稿元を識別する任意の文字列で、同じkeyで再度呼び出すと内容を更新できる
     */
    postStatusMessage(key: string, message: string): void {
      this.statusMessages.set(key, message);
    },

    /**
     * 指定したkeyのステータスメッセージを取り下げる
     */
    clearStatusMessage(key: string): void {
      this.statusMessages.delete(key);
    },

    /**
     * 関係性登録モードを終了する（待機中の状態・連続定義モードも解除する）
     */
    cancelRelationalMode(): void {
      this.relationalMode = undefined;
      this.relationalPendingId = undefined;
      this.relationalPendingFile = undefined;
      this.relationalContinuous = false;
      this.relationalLastPairedId = undefined;
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
     * 1組の関係性登録が確定した際の後処理をまとめて行う
     *
     * 待機状態は常に解除する。連続定義モード（ダブルクリックで開始）が有効な場合のみ、
     * 次のペア登録に備えてモード自体を維持する。無効な場合はここでモードごと終了しないと、
     * 次に選択・作成したアノテーションが新たな1つ目として誤って待機開始してしまい、
     * ユーザーが意図しない関係性の二重登録につながる
     */
    finishRelationalPending(): void {
      this.cancelRelationalPending();
      if (!this.relationalContinuous) {
        this.relationalMode = undefined;
      }
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
     * 指定タブの最終表示状態を記録する（タブの再選択・再オープン後の復元に使う）
     */
    setTabViewState(
      file: { containerID: ContainerID; path: string },
      viewState: TabViewState,
    ): void {
      this.tabViewStates[tabKey(file)] = viewState;
    },

    /**
     * 指定タブに記録済みの最終表示状態を取得する（未記録の場合はundefined）
     */
    getTabViewState(file: { containerID: ContainerID; path: string }): TabViewState | undefined {
      return this.tabViewStates[tabKey(file)];
    },

    /**
     * 選択された文書のタブを開く
     *
     * containerIDまで含めて同一性判定するため、別コンテナの同名パスファイルも正しく別タブとして開かれる。
     * `targetPage`を指定すると、開いた後にそのページへ遷移する（対象のDocumentTabView.vueが
     * `pendingTabFocus`を消費して処理する。ページ遷移とタブを開く操作を1回の呼び出しにまとめることで、
     * 呼び出し順序に依存する別々の意図フラグを個別に扱う必要をなくしている）
     */
    openTab(elem: ContainerElement, targetPage?: number, focusAnnotId?: AnnotationID): void {
      if (elem.type !== 'File') return;

      const isAlreadyOpened = this.tabs[this.activeSide].some(
        (tab) => tabKey(tab) === tabKey(elem),
      );
      if (!isAlreadyOpened) {
        this.tabs[this.activeSide].push(elem);
      }
      this.selectTab(elem, this.activeSide, true);

      if (targetPage !== undefined) {
        this.pendingTabFocus = {
          containerID: elem.containerID,
          path: elem.path,
          page: targetPage,
          annotId: focusAnnotId,
        };
      }
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
     * 設定タブを開き、指定セクションへ自動スクロールするよう要求する
     */
    requestSettingsScroll(id: string): void {
      this.openSettingsTab();
      this.settingsScrollTarget = id;
    },

    /**
     * 設定タブへの自動スクロール要求を消費（解除）する
     */
    clearSettingsScrollTarget(): void {
      this.settingsScrollTarget = undefined;
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

      const remappedViewStates: Record<string, TabViewState> = {};
      Object.entries(this.tabViewStates).forEach(([key, viewState]) => {
        const prefix = `${containerID}|`;
        const path = key.startsWith(prefix) ? key.slice(prefix.length) : undefined;
        const newKey =
          path !== undefined && pathMap[path] !== undefined
            ? tabKey({ containerID, path: pathMap[path] })
            : key;
        remappedViewStates[newKey] = viewState;
      });
      this.tabViewStates = remappedViewStates;

      const pendingFile = this.relationalPendingFile;
      if (pendingFile !== undefined && pendingFile.containerID === containerID) {
        const newPendingPath = pathMap[pendingFile.path];
        if (newPendingPath !== undefined) pendingFile.path = newPendingPath;
      }
    },

    /**
     * アノテーションのアプリ内クリップボードにコピーする
     */
    setAnnotationClipboard(items: AnnotationStyle[]): void {
      this.annotationClipboard = items;
    },

    /**
     * アノテーションのアプリ内クリップボードを空にする
     */
    clearAnnotationClipboard(): void {
      this.annotationClipboard = null;
    },

    /**
     * 指定タブで、カーソルが最後にPDFページ上でホバーしていた位置（文書座標）を記録する
     */
    setLastPointerDocPos(
      file: { containerID: ContainerID; path: string },
      pos: { page: number; x: number; y: number },
    ): void {
      this.lastPointerDocPos[tabKey(file)] = pos;
    },

    /**
     * 指定タブに記録済みの最終ポインタ位置を取得する（未記録の場合はundefined）
     */
    getLastPointerDocPos(file: {
      containerID: ContainerID;
      path: string;
    }): { page: number; x: number; y: number } | undefined {
      return this.lastPointerDocPos[tabKey(file)];
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
     * 削除操作の意図をセットする（アノテーション右クリックメニューの「削除」から使う。
     * 確認ダイアログは表示しない即時削除）
     */
    requestDelete(): void {
      this.deleteRequested = true;
    },

    /**
     * 削除操作の意図フラグを解除する
     */
    clearDeleteRequest(): void {
      this.deleteRequested = false;
    },

    /**
     * 関係性ダイアログを開く意図をセットする（アノテーション右クリックメニューの
     * 「関係性ダイアログを開く」から使う）
     */
    requestPeek(annotId: AnnotationID): void {
      this.peekRequestedAnnotId = annotId;
    },

    /**
     * 関係性ダイアログを開く意図フラグを解除する
     */
    clearPeekRequest(): void {
      this.peekRequestedAnnotId = undefined;
    },

    /**
     * `openTab`で指定されたページ遷移情報を解除する
     */
    clearPendingTabFocus(): void {
      this.pendingTabFocus = undefined;
    },

    /**
     * 指定ファイルのブックマークが（自身の操作ではなく）外部から更新されたことを通知する。
     * アノテーション右クリックメニューからのブックマーク登録など、ブックマークパネル自身が
     * 直接検知できない変更の後に呼ぶことで、パネル側の再読込を促す
     */
    touchBookmarks(file: { containerID: ContainerID; path: string }): void {
      const key = tabKey(file);
      this.bookmarksRevision[key] = (this.bookmarksRevision[key] ?? 0) + 1;
    },

    /**
     * 指定ファイルの現在のブックマークリビジョンを取得する（`touchBookmarks`の対にして
     * `watch`対象に使う。値そのものに意味は無く、変化したことだけを検知するために使う）
     */
    getBookmarksRevision(file: { containerID: ContainerID; path: string }): number | undefined {
      return this.bookmarksRevision[tabKey(file)];
    },

    /**
     * アクティブなペインの表示モードをメインツール用に反映する
     */
    setActiveViewMode(mode: ViewMode): void {
      this.activeViewMode = mode;
    },

    /**
     * 指定ペインが現在表示しているページ番号を記録する（DocumentTabView.vueが
     * 自身のcurrentPageの変化のたびに呼ぶ）
     */
    setActiveTabCurrentPage(layoutSide: LayoutSide, page: number): void {
      this.activeTabCurrentPage[layoutSide] = page;
    },

    /**
     * メインツールから表示モード変更を要求する（実際の適用はアクティブなペインが行う）
     */
    requestViewMode(mode: ViewMode): void {
      this.viewModeAction = mode;
    },

    /**
     * 表示モード変更の意図フラグを解除する
     */
    clearViewModeAction(): void {
      this.viewModeAction = undefined;
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

    /**
     * プラグイン所有タブを開く（現在アクティブなペインに、文書タブと同様の見た目で開かれる）
     *
     * 同じプラグインを指定した場合は既存タブをそのままアクティブにする（同一プラグインに
     * つき常に1タブ。タブ内で入力フォーム経由の再実行に対応する）
     */
    openPluginTab(pluginId: PluginID, source: PluginInstallSource, title: string): void {
      const key = pluginTabKey(pluginId, source);
      const side = this.activeSide;
      if (!this.pluginTabs[side].some((t) => t.key === key)) {
        this.pluginTabs[side].push({ key, pluginId, source, title });
      }
      this.activeTabPaths[side] = key;
    },

    /**
     * プラグイン所有タブを選択する
     */
    selectPluginTab(key: string, layoutSide: LayoutSide, isFocus: boolean): void {
      this.activeTabPaths[layoutSide] = key;
      if (isFocus) this.activeSide = layoutSide;
    },

    /**
     * プラグイン所有タブを閉じる
     */
    closePluginTab(key: string, layoutSide: LayoutSide): void {
      const targetIdx = this.pluginTabs[layoutSide].findIndex((t) => t.key === key);
      if (targetIdx === -1) return;

      this.pluginTabs[layoutSide].splice(targetIdx, 1);

      if (this.activeTabPaths[layoutSide] === key) {
        const lastTab = this.tabs[layoutSide][this.tabs[layoutSide].length - 1];
        this.activeTabPaths[layoutSide] = lastTab ? tabKey(lastTab) : null;
      }
    },

    /**
     * コンテナ設定タブを開く（現在アクティブなペインに、文書タブと同様の見た目で開かれる）
     *
     * 同じコンテナを指定した場合は既存タブをそのままアクティブにする（同一コンテナにつき常に1タブ）
     */
    openContainerSettingsTab(containerID: ContainerID, title: string): void {
      const key = containerSettingsTabKey(containerID);
      const side = this.activeSide;
      if (!this.containerSettingsTabs[side].some((t) => t.key === key)) {
        this.containerSettingsTabs[side].push({ key, containerID, title });
      }
      this.activeTabPaths[side] = key;
    },

    /**
     * コンテナ設定タブを選択する
     */
    selectContainerSettingsTab(key: string, layoutSide: LayoutSide, isFocus: boolean): void {
      this.activeTabPaths[layoutSide] = key;
      if (isFocus) this.activeSide = layoutSide;
    },

    /**
     * コンテナ設定タブを閉じる
     */
    closeContainerSettingsTab(key: string, layoutSide: LayoutSide): void {
      const targetIdx = this.containerSettingsTabs[layoutSide].findIndex((t) => t.key === key);
      if (targetIdx === -1) return;

      this.containerSettingsTabs[layoutSide].splice(targetIdx, 1);

      if (this.activeTabPaths[layoutSide] === key) {
        const lastTab = this.tabs[layoutSide][this.tabs[layoutSide].length - 1];
        this.activeTabPaths[layoutSide] = lastTab ? tabKey(lastTab) : null;
      }
    },

    /**
     * 指定コンテナのコンテナ設定タブを、開かれている全ペインから閉じる
     *
     * コンテナのアンロード時に呼び出し、実体を失ったコンテナの設定タブが残り続けないようにする
     */
    closeContainerSettingsTabsForContainer(cID: ContainerID): void {
      const key = containerSettingsTabKey(cID);
      sides.forEach((side) => {
        if (this.containerSettingsTabs[side].some((t) => t.key === key)) {
          this.closeContainerSettingsTab(key, side);
        }
      });
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useEditorStore, import.meta.hot));
}
