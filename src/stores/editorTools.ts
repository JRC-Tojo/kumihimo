import type { DrawingAnnotationType, IDocTool } from 'src/models/docPage';
import type { AnnotationStyle } from 'src/models/document/pdf';
import { useEditorStore } from './editorStore';
import { useSettingsStore } from './settingsStore';
import { useBackendApi } from 'src/apis/backendApi';
import { saveDocument } from 'src/utils/document/saveDocument';
import { ANNOTATION_REGISTRY } from 'src/components/Viewer/Annotation/registry';
import { ANNOTATION_GEOMETRY } from 'src/services/document/annotationGeometry';

/**
 * 指定した種別の先頭プリセット（ユーザー設定になければレジストリのデフォルト）のスタイルを取得する
 */
function firstPresetStyleForType(toolType: DrawingAnnotationType) {
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

  const tools: IDocTool[] = [
    {
      id: 'save-overwrite',
      icon: 'save',
      label: t('pdfEditor.tools.save.overwrite'),
      isActive: () => false,
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
      isActive: () => false,
      onClicked: () => {
        /** TODO: 今後実装 */
      },
    },
  ]

  return tools
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
    onClicked: () => {
      editorStore.activeAnnotationType = type;
      editorStore.currentTools = type;

      // 先頭プリセットを自動適用し、MainTool選択直後から即描画に移れるようにする
      const style = firstPresetStyleForType(type);
      if (style !== undefined) editorStore.currentAnnotationStyle = style;
    },
  }));

  const tools: IDocTool[] = [
    ...annotationTypeTools,
    {
      id: 'toggle-relational',
      icon: 'school',
      label: t('pdfEditor.tools.relationalToggle'),
      isActive: () => editorStore.relationalMode !== undefined,
      onClicked: () => {
        const subTools: IDocTool[] = [
          {
            id: 'rel-equal-mode',
            icon: 'sync_alt',
            label: t('pdfEditor.tools.relational.equal'),
            isActive: () => editorStore.relationalMode === 'equal',
            onClicked: () => {
              editorStore.relationalMode = 'equal';
            },
          },
          {
            id: 'rel-link-mode',
            icon: 'link',
            label: t('pdfEditor.tools.relational.link'),
            isActive: () => editorStore.relationalMode === 'link',
            onClicked: () => {
              editorStore.relationalMode = 'link';
            },
          },
          {
            id: 'rel-off-mode',
            icon: 'link_off',
            label: t('pdfEditor.tools.relational.off'),
            isActive: () => editorStore.relationalMode === undefined,
            onClicked: () => {
              editorStore.cancelRelationalMode();
            },
          },
        ];
        editorStore.subTools = subTools;
      },
    },
    {
      id: 'layer-order-menu',
      icon: 'layers',
      label: t('pdfEditor.tools.layerOrder.title'),
      isActive: () => false,
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
      isActive: () => editorStore.visibleAnnotations,
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
      id: 'toggle-left-drawer',
      icon: 'menu',
      label: t('pdfEditor.leftDrawer.title'),
      isActive: () => false,
      onClicked: () => {
        editorStore.leftDrawerModel = !editorStore.leftDrawerModel;
      },
    },
    {
      id: 'hand-mode',
      icon: 'pan_tool',
      label: t('pdfEditor.tools.handMode'),
      isActive: () => {
        return editorStore.currentTools === 'hand';
      },
      onClicked: () => {
        editorStore.currentTools = 'hand';
      },
    },
    {
      id: 'select-mode',
      icon: 'touch_app',
      label: t('pdfEditor.tools.selectMode'),
      isActive: () => {
        return editorStore.currentTools === 'pointer';
      },
      onClicked: () => {
        editorStore.currentTools = 'pointer';
      },
    },
  ];
  return tools;
}

/**
 * ドキュメント操作ツール一覧を取得
 * @param t - i18n 翻訳関数
 * @returns ドキュメント操作ツール配列
 */
function callDocTools(t: (key: string) => string): IDocTool[] {
  const editorStore = useEditorStore();

  const tools: IDocTool[] = [
    {
      id: 'save-menu',
      icon: 'save',
      label: t('pdfEditor.tools.save.title'),
      isActive: () => false,
      onClicked: () => {
        const subTools: IDocTool[] = [
          {
            id: 'save-overwrite',
            icon: 'save',
            label: t('pdfEditor.tools.save.overwrite'),
            isActive: () => false,
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
            isActive: () => false,
            onClicked: () => {
              /** TODO: 今後実装 */
            },
          },
          {
            id: 'auto-save-toggle',
            icon: 'backup',
            label: t('pdfEditor.tools.save.auto'),
            isActive: () => editorStore.autoSaveAnnotations,
            onClicked: async () => {
              const previous = editorStore.autoSaveAnnotations;
              editorStore.autoSaveAnnotations = !previous;
              const result = await useBackendApi().saveSettings(
                'autoSaveAnnotations',
                editorStore.autoSaveAnnotations,
              );
              if (!result.ok) {
                editorStore.autoSaveAnnotations = previous;
              }
            },
          },
        ];
        editorStore.subTools = subTools;
      },
    },
    {
      id: 'print',
      icon: 'print',
      label: t('pdfEditor.tools.print'),
      isActive: () => false,
      onClicked: () => {
        // TODO: 暫定実装
        window.print();
      },
    },
    {
      id: 'download',
      icon: 'download',
      label: t('pdfEditor.tools.download'),
      isActive: () => false,
      onClicked: () => {
        /** TODO: 今後実装 */
      },
    },
    {
      id: 'tab-tile-menu',
      icon: 'grid_view',
      label: t('pdfEditor.tools.viewStyle.title'),
      isActive: () => false,
      onClicked: () => {
        const subTools: IDocTool[] = [
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
        editorStore.subTools = subTools;
      },
    },
    {
      id: 'toggle-right-drawer',
      icon: 'info',
      label: t('pdfEditor.rightDrawer.title'),
      isActive: () => false,
      onClicked: () => {
        editorStore.rightDrawerModel = !editorStore.rightDrawerModel;
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
  return Array.prototype.concat(pointer, annotation, docs);
}

/**
 * ヘッダーのうち左上に表示するツールを取得
 */
export function callLeftHeaderTools(t: (key: string) => string): IDocTool[] {
  const saving = callSavingTools(t)
  return saving
}