import type { DrawingAnnotationType, IDocTool } from 'src/models/docPage';
import type { AnnotationStyle } from 'src/models/document/pdf';
import { useEditorStore } from './editorStore';
import { useHistoryStore } from './historyStore';
import { useSettingsStore } from './settingsStore';
import { useBackendApi } from 'src/apis/backendApi';
import { saveDocument } from 'src/utils/document/saveDocument';
import { saveDocumentAs } from 'src/utils/document/saveDocumentAs';
import { saveAsDialog } from 'src/components/Dialog/saveAsDialog';
import { ANNOTATION_REGISTRY } from 'src/components/Viewer/Annotation/registry';
import { ANNOTATION_GEOMETRY } from 'src/components/Viewer/Annotation/annotationGeometry';
import { shouldInheritSelectionStyle } from 'src/utils/document/annotationToolClickMode';
import { annotationStyleToPresetStyle } from 'src/components/DocLayout/composables/useAnnotationPresets';

/**
 * 指定した種別の先頭プリセット（ユーザー設定になければレジストリのデフォルト）のスタイルを取得する
 */
export function firstPresetStyleForType(toolType: DrawingAnnotationType) {
  const settingsStore = useSettingsStore();
  const userPreset = settingsStore.appSettings?.tools.annotations.find(
    (ann) => ann.style.type === toolType,
  );
  return userPreset?.style ?? ANNOTATION_GEOMETRY[toolType].defaultPresets[0]?.style;
}

/**
 * 文書保存ツール一覧を取得
 */
function callSavingTools(t: (key: string) => string): IDocTool[] {
  const editorStore = useEditorStore();
  const isFileActive = () => editorStore.getActiveTab(editorStore.activeSide) !== null;

  const tools: IDocTool[] = [
    {
      id: 'save-overwrite',
      icon: 'save',
      label: t('pdfEditor.tools.save.overwrite'),
      isActive: isFileActive,
      onClicked: () => {
        const activeFile = editorStore.getActiveTab(editorStore.activeSide);
        if (!activeFile) return;
        void saveDocument(activeFile, {
          success: t('pdfEditor.tools.save.success'),
          failed: t('pdfEditor.tools.save.failed'),
        });
      },
    },
    {
      id: 'save-as',
      icon: 'save_as',
      label: t('pdfEditor.tools.save.saveAs'),
      isActive: isFileActive,
      onClicked: async () => {
        const activeFile = editorStore.getActiveTab(editorStore.activeSide);
        if (!activeFile) return;

        const result = await saveAsDialog({ sourceFile: activeFile });
        if (!result) return;

        void saveDocumentAs(
          activeFile,
          { containerID: result.containerID, filePath: result.filePath },
          result.mode,
          {
            success: t('pdfEditor.tools.save.success'),
            failed: t('pdfEditor.tools.save.failed'),
          },
          {
            title: t('pdfEditor.tools.save.fontEmbedRiskTitle'),
            unsupportedMessage: t('pdfEditor.tools.save.fontEmbedRiskMessageUnsupported'),
            deniedMessage: t('pdfEditor.tools.save.fontEmbedRiskMessageDenied'),
          },
        );
      },
    },
  ];

  return tools;
}

/**
 * Undo/Redoツール一覧を取得
 *
 * ヘッダーツールはグローバルに一度だけ生成される（ペインごとではない）ため、クリック・活性判定は
 * その時点でのアクティブなペイン・タブを都度解決する（callSavingToolsのisFileActiveと同じパターン）
 */
function callHistoryTools(t: (key: string) => string): IDocTool[] {
  const editorStore = useEditorStore();
  const historyStore = useHistoryStore();
  const activeFile = () => editorStore.getActiveTab(editorStore.activeSide);

  return [
    {
      id: 'history-undo',
      icon: 'undo',
      label: t('pdfEditor.tools.history.undo'),
      isActive: () => false,
      isDisable: () => {
        const file = activeFile();
        return !file || !historyStore.canUndo(file) || historyStore.isBusy(file);
      },
      onClicked: () => {
        const file = activeFile();
        if (file) void historyStore.undo(file);
      },
    },
    {
      id: 'history-redo',
      icon: 'redo',
      label: t('pdfEditor.tools.history.redo'),
      isActive: () => false,
      isDisable: () => {
        const file = activeFile();
        return !file || !historyStore.canRedo(file) || historyStore.isBusy(file);
      },
      onClicked: () => {
        const file = activeFile();
        if (file) void historyStore.redo(file);
      },
    },
  ];
}

function callLayoutTools(t: (key: string) => string): IDocTool[] {
  const editorStore = useEditorStore();

  const tools: IDocTool[] = [
    {
      id: 'single-tab-mode',
      icon: 'crop_portrait',
      label: t('pdfEditor.tools.viewStyle.noGrid'),
      isActive: () => editorStore.tileMode === 'single',
      onClicked: () => {
        editorStore.tileMode = 'single';
      },
    },
    {
      id: 'dubble-tab-mode',
      icon: 'vertical_split',
      label: t('pdfEditor.tools.viewStyle.split'),
      isActive: () => editorStore.tileMode === 'dubble',
      onClicked: () => {
        editorStore.tileMode = 'dubble';
      },
    },
    {
      id: 'grid-tab-mode',
      icon: 'grid_view',
      label: t('pdfEditor.tools.viewStyle.grid'),
      isActive: () => editorStore.tileMode === 'grid',
      onClicked: () => {
        editorStore.tileMode = 'grid';
      },
    },
  ];

  return tools;
}

/**
 * アノテーションツール一覧を取得
 * @param t - i18n 翻訳関数
 * @returns アノテーションツール配列
 */
async function callAnnotationTools(t: (key: string) => string): Promise<IDocTool[]> {
  const editorStore = useEditorStore();
  const api = useBackendApi();

  const settings = await api.getSettings();
  if (!settings.ok) return [];

  // メインツールバーのアノテーション種別ボタンはレジストリから生成する。
  // 新しいアノテーション種別を追加する際、このファイルの変更は不要になる。
  const annotationTypeTools: IDocTool[] = (
    Object.entries(ANNOTATION_REGISTRY) as [
      AnnotationStyle['type'],
      (typeof ANNOTATION_REGISTRY)[AnnotationStyle['type']],
    ][]
  ).map(([type, mod]) => ({
    id: `annotation-${type}`,
    icon: mod.mainToolIcon,
    label: t(`pdfEditor.tools.${type}`),
    isActive: () => editorStore.currentTools === type,
    isDisable: () => editorStore.activeViewMode === 'pageList',
    onClicked: () => {
      const selection = editorStore.activeSelection?.annotations;
      const inheritStyle = shouldInheritSelectionStyle(selection, type);

      // 選択中かどうかに関わらず、MainToolsのクリックは常に描画モードへ切り替える（issue #58）
      editorStore.activeAnnotationType = type;
      editorStore.currentTools = type;

      if (inheritStyle && selection?.[0]) {
        // 選択中アノテーションと同じ種別のツールを選んだ場合はそのスタイルを引き継ぐ
        // （関係性登録でペアとなるアノテーションを作る際、直前の見た目のまま描けるようにする。
        //   これによりMainTools経由のプリセット登録でも選択中だったスタイルが対象になる）
        editorStore.currentAnnotationStyle = annotationStyleToPresetStyle(selection[0]);
      } else if (type !== editorStore.currentAnnotationStyle.type) {
        // 先頭プリセットを自動適用し、MainTool選択直後から即描画に移れるようにする
        // cf) ただし，以下の条件では自動適用しない
        //     - 選択中のタイプと同じ種別が選択されたとき
        const style = firstPresetStyleForType(type);
        if (style !== undefined) editorStore.currentAnnotationStyle = style;
      }

      // テキストツールの選択時、Local Font Access権限を先読みで要求しておく。
      // 保存（埋め込み）処理はユーザー操作の直後とは限らず、その場で初回の許可プロンプトを
      // 出せないことがあるため、確実にクリックハンドラ内にある今のうちに要求しておく
      if (type === 'text') {
        api.prefetchLocalFonts();
      }
    },
  }));

  const tools: IDocTool[] = [
    ...annotationTypeTools,
    {
      id: 'layer-order-menu',
      icon: 'layers',
      label: t('pdfEditor.tools.layerOrder.title'),
      isActive: () => false,
      isDisable: () => editorStore.activeViewMode === 'pageList',
      onClicked: () => {
        const subTools: IDocTool[] = [
          {
            id: 'layer-order-front',
            icon: 'flip_to_front',
            label: t('pdfEditor.tools.layerOrder.bringToFront'),
            isActive: () => false,
            onClicked: () => editorStore.requestLayerOrder('front'),
          },
          {
            id: 'layer-order-forward',
            icon: 'north',
            label: t('pdfEditor.tools.layerOrder.bringForward'),
            isActive: () => false,
            onClicked: () => editorStore.requestLayerOrder('forward'),
          },
          {
            id: 'layer-order-backward',
            icon: 'south',
            label: t('pdfEditor.tools.layerOrder.sendBackward'),
            isActive: () => false,
            onClicked: () => editorStore.requestLayerOrder('backward'),
          },
          {
            id: 'layer-order-back',
            icon: 'flip_to_back',
            label: t('pdfEditor.tools.layerOrder.sendToBack'),
            isActive: () => false,
            onClicked: () => editorStore.requestLayerOrder('back'),
          },
        ];
        editorStore.subTools = subTools;
      },
    },
    {
      id: 'toggle-annotation-visibility',
      icon: 'visibility',
      label: t('pdfEditor.tools.annotationToggle'),
      noMenu: true,
      isActive: () => editorStore.visibleAnnotations,
      isDisable: () => editorStore.activeViewMode === 'pageList',
      onClicked: () => {
        editorStore.visibleAnnotations = !editorStore.visibleAnnotations;
      },
    },
  ];

  return tools;
}

/**
 * ポインタツール一覧を取得
 * @param t - i18n 翻訳関数
 * @returns ポインタツール配列
 */
function callPointerTools(t: (key: string) => string): IDocTool[] {
  const editorStore = useEditorStore();

  const tools: IDocTool[] = [
    {
      id: 'hand-mode',
      icon: 'pan_tool',
      label: t('pdfEditor.tools.handMode'),
      noMenu: true,
      isActive: () => {
        return editorStore.currentTools === 'hand';
      },
      isDisable: () => editorStore.activeViewMode === 'pageList',
      onClicked: () => {
        editorStore.currentTools = 'hand';
      },
    },
    {
      id: 'select-mode',
      icon: 'touch_app',
      label: t('pdfEditor.tools.selectMode'),
      noMenu: true,
      isActive: () => {
        return editorStore.currentTools === 'pointer';
      },
      isDisable: () => editorStore.activeViewMode === 'pageList',
      onClicked: () => {
        editorStore.currentTools = 'pointer';
      },
    },
  ];
  return tools;
}

/**
 * 表示モード（単一/連続）切り替えツールを取得
 *
 * 表示モード自体はペインごとのローカルstate（DocumentTabView.vueの`viewMode`）のため、
 * layerOrderActionと同じ「意図をeditorStoreに橋渡しする」パターンで扱う。
 * サブツールの活性判定は、アクティブなペインからeditorStoreへ橋渡しされた`activeViewMode`を参照する
 */
function callViewTools(t: (key: string) => string): IDocTool[] {
  const editorStore = useEditorStore();

  return [
    {
      id: 'view-mode-menu',
      icon: 'view_agenda',
      label: t('pdfEditor.footer.viewMode.title'),
      isActive: () => false,
      onClicked: () => {
        const subTools: IDocTool[] = [
          {
            id: 'view-mode-single',
            icon: 'description',
            label: t('pdfEditor.footer.viewMode.single'),
            isActive: () => editorStore.activeViewMode === 'single',
            onClicked: () => editorStore.requestViewMode('single'),
          },
          {
            id: 'view-mode-continuous',
            icon: 'view_stream',
            label: t('pdfEditor.footer.viewMode.c_single'),
            isActive: () => editorStore.activeViewMode === 'continuousSingle',
            onClicked: () => editorStore.requestViewMode('continuousSingle'),
          },
          {
            id: 'view-mode-page-list',
            icon: 'grid_view',
            label: t('pdfEditor.footer.viewMode.pageList'),
            isActive: () => editorStore.activeViewMode === 'pageList',
            onClicked: () => editorStore.requestViewMode('pageList'),
          },
        ];
        editorStore.subTools = subTools;
      },
    },
  ];
}

/**
 * ドキュメント操作ツール一覧を取得
 * @param t - i18n 翻訳関数
 * @returns ドキュメント操作ツール配列
 */
function callDocTools(t: (key: string) => string): IDocTool[] {
  const tools: IDocTool[] = [
    {
      id: 'print',
      icon: 'print',
      label: t('pdfEditor.tools.print'),
      noMenu: true,
      isActive: () => false,
      onClicked: () => {
        // TODO: 暫定実装
        window.print();
      },
    },
  ];
  return tools;
}

/**
 * すべてのエディタツールを取得
 * @param t - i18n 翻訳関数
 * @returns 全エディタツール配列
 */
export async function callEditorTools(t: (key: string) => string): Promise<IDocTool[]> {
  // TODO: 戻り値を２次元配列にして，その区切りにq-separatorを描画する？
  const docs = callDocTools(t);
  const pointer = callPointerTools(t);
  const annotation = await callAnnotationTools(t);
  const view = callViewTools(t);
  return Array.prototype.concat(pointer, annotation, view, docs);
}

/**
 * ヘッダーのうち左上に表示するツールを取得
 */
export function callLeftHeaderTools(t: (key: string) => string): IDocTool[] {
  const history = callHistoryTools(t);
  const saving = callSavingTools(t);
  return [...history, ...saving];
}

/**
 * ヘッダーのうち右上に表示するツールを取得
 */
export function callRightHeaderTools(t: (key: string) => string): IDocTool[] {
  const saving = callLayoutTools(t);
  return saving;
}
