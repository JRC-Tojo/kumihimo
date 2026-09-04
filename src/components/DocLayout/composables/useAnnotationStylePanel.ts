/**
 * アノテーションスタイルパネル（AnnotationStylePanel.vue）の状態変換をまとめたコンポーザブル
 *
 * パネルはIllustrator/Affinity的に「選択中の配置済みアノテーションがあればそれを直接編集し、
 * なければ次に描く注釈のスタイル（editorStore.currentAnnotationStyle）を編集する」という
 * デュアルモードで動作する。2つのモードはフィールド名が異なる（テンプレート側は`strokeColor`、
 * 配置済み側は`color`）ため、パネルコンポーネントからは統一したフィールド名
 * （color/strokeWidth/strokeType/opacity等）で読み書きできるようにする
 */

import { computed, type WritableComputedRef } from 'vue';
import { useEditorStore } from 'src/stores/editorStore';
import { useRelationalStore } from 'src/stores/relationalStore';
import { useAnnotationHistory } from './useAnnotationHistory';
import { buildPresetApplyPatch } from './useAnnotationPresets';
import { toColorCode } from 'src/utils/color/toColorCode';
import type { DrawingAnnotationStyle, DrawingAnnotationType } from 'src/models/docPage';
import type {
  AnnotationStyle,
  ArrowHeadType,
  BlendMode,
  StrokeType,
} from 'src/models/document/pdf';

export type StylePanelMode = 'draw' | 'selection' | 'none';

/** 複数選択時、全アイテムで値が一致していればその値を、食い違っていればundefined（混在）を返す */
function commonValue<T, V>(items: T[], getter: (item: T) => V): V | undefined {
  if (items.length === 0) return undefined;
  const first = getter(items[0] as T);
  return items.every((item) => getter(item) === first) ? first : undefined;
}

export function useAnnotationStylePanel() {
  const editorStore = useEditorStore();
  const relationalStore = useRelationalStore();
  const history = useAnnotationHistory();

  const mode = computed<StylePanelMode>(() => {
    if (editorStore.activeAnnotationType !== undefined) return 'draw';
    if ((editorStore.activeSelection?.annotations.length ?? 0) > 0) return 'selection';
    return 'none';
  });

  /** 選択中アノテーションが関係性検証結果（OK/NG、または一覧読み込み失敗によるNG相当扱い）の
   * スタイルで上書き描画されているかどうか。上書き中は「線色」「塗り色」「塗りの不透明度」
   * 「線の太さ」を編集してもここでは何をしても画面に反映されない（`relationalStyleOverride.ts`が
   * 優先されるため）ので、編集不可にする判定に使う。一方、線の不透明度・線種・合成モードは
   * 上書きの対象外のため、そちらは対象にしない */
  const relationalOverrideActive = computed<boolean>(() => {
    const selection = editorStore.activeSelection;
    const annotations = selection?.annotations;
    if (mode.value !== 'selection' || selection === undefined || annotations?.length !== 1)
      return false;
    if (relationalStore.hasLoadError(selection.file)) return true;
    const status = relationalStore.statusForAnnotation((annotations[0] as AnnotationStyle).id);
    return status === 'ok' || status === 'ng';
  });

  /** 対象の種別。選択編集モードで種別が混在している場合はundefined（共通4項目のみ表示） */
  const effectiveType = computed<DrawingAnnotationType | undefined>(() => {
    if (mode.value === 'draw') return editorStore.activeAnnotationType;
    if (mode.value === 'selection') {
      const types = new Set(editorStore.activeSelection?.annotations.map((a) => a.type) ?? []);
      return types.size === 1 ? [...types][0] : undefined;
    }
    return undefined;
  });

  /** 選択中の全アノテーションに、種別に応じたpatchを適用して保存する（対象外の種別はnullを返してスキップする） */
  async function applyToSelection(
    building: (annot: AnnotationStyle) => Partial<AnnotationStyle> | null,
  ): Promise<void> {
    const selection = editorStore.activeSelection;
    if (!selection) return;

    const items = history.buildRegisterManyItems(selection.annotations, building);
    await history.registerManyWithHistory(selection.file, items);
  }

  /** 選択中の全アノテーションに、プリセットのスタイルを一括適用する（種別が異なるものはスキップされる） */
  async function applyPresetStyleToSelection(preset: DrawingAnnotationStyle): Promise<void> {
    await applyToSelection(buildPresetApplyPatch(preset));
  }

  function patchDrawStyle(patch: Record<string, unknown>): void {
    editorStore.currentAnnotationStyle = {
      ...editorStore.currentAnnotationStyle,
      ...patch,
    };
  }

  /** 色以外の全種別共通フィールドを、モードに応じたget/setで統一的に扱うwritable computedを作る */
  function universalField<V>(
    drawKey: 'strokeWidth' | 'strokeType' | 'strokeOpacity' | 'blendMode',
    selectionKey: 'strokeWidth' | 'strokeType' | 'strokeOpacity' | 'blendMode',
  ): WritableComputedRef<V | undefined> {
    return computed<V | undefined>({
      get: () => {
        if (mode.value === 'draw') {
          return (editorStore.currentAnnotationStyle as unknown as Record<string, V>)[drawKey];
        }
        if (mode.value === 'selection') {
          return commonValue(
            editorStore.activeSelection?.annotations ?? [],
            (a) => (a as unknown as Record<string, V>)[selectionKey],
          );
        }
        return undefined;
      },
      set: (value) => {
        if (value === undefined) return;
        if (mode.value === 'draw') patchDrawStyle({ [drawKey]: value });
        else if (mode.value === 'selection') {
          void applyToSelection(() => ({ [selectionKey]: value }));
        }
      },
    });
  }

  const strokeWidth = universalField<number>('strokeWidth', 'strokeWidth');
  const strokeType = universalField<StrokeType>('strokeType', 'strokeType');
  /** 全種別共通の線の不透明度。strokeOpacity未設定時は、描画側（resolveOpacity）と同じく
   * 後方互換用の旧opacityフィールドにフォールバックする（そうしないと、strokeOpacity導入以前に
   * 保存された既存アノテーションを選択した際、実際の描画とは異なる値がパネルに表示されてしまう） */
  const opacity = computed<number | undefined>({
    get: () => {
      if (mode.value === 'draw') {
        // 描画スタイル（次に描く注釈のスタイル）は常に新規構築されるため旧opacityフィールドを持たない
        return editorStore.currentAnnotationStyle.strokeOpacity;
      }
      if (mode.value === 'selection') {
        return commonValue(
          editorStore.activeSelection?.annotations ?? [],
          (a) => a.strokeOpacity ?? a.opacity,
        );
      }
      return undefined;
    },
    set: (value) => {
      if (value === undefined) return;
      if (mode.value === 'draw') patchDrawStyle({ strokeOpacity: value });
      else if (mode.value === 'selection') {
        void applyToSelection(() => ({ strokeOpacity: value }));
      }
    },
  });
  /** 全種別共通の合成モード（半透明の図形を下地の文書とどう重ねるか） */
  const blendMode = universalField<BlendMode>('blendMode', 'blendMode');

  /** 全種別共通の線色 */
  const color = computed<string | undefined>({
    get: () => {
      if (mode.value === 'draw') return editorStore.currentAnnotationStyle.strokeColor;
      if (mode.value === 'selection') {
        return commonValue(editorStore.activeSelection?.annotations ?? [], (a) => a.color);
      }
      return undefined;
    },
    set: (value) => {
      // value===undefinedは「色なし」の明示的な選択のため、他フィールドと異なりここでは無視しない
      if (mode.value === 'draw') {
        patchDrawStyle({ strokeColor: value });
        return;
      }
      if (mode.value === 'selection') {
        if (value === undefined) {
          void applyToSelection(() => ({ color: undefined }));
          return;
        }
        const parsed = toColorCode(value);
        if (parsed === undefined) return;
        void applyToSelection(() => ({ color: parsed }));
      }
    },
  });

  /** box/circle/polygon/textのみ有効な塗り色 */
  const fillColor = computed<string | undefined>({
    get: () => {
      if (mode.value === 'draw') {
        const style = editorStore.currentAnnotationStyle;
        return style.type === 'box' ||
          style.type === 'circle' ||
          style.type === 'polygon' ||
          style.type === 'text'
          ? style.fillColor
          : undefined;
      }
      if (mode.value === 'selection') {
        return commonValue(editorStore.activeSelection?.annotations ?? [], (a) =>
          a.type === 'box' || a.type === 'circle' || a.type === 'polygon' || a.type === 'text'
            ? a.fillColor
            : undefined,
        );
      }
      return undefined;
    },
    set: (value) => {
      // value===undefinedは「塗りなし」の明示的な選択のため、他フィールドと異なりここでは無視しない
      if (mode.value === 'draw') {
        patchDrawStyle({ fillColor: value });
        return;
      }
      if (mode.value === 'selection') {
        if (value === undefined) {
          void applyToSelection((annot) =>
            annot.type === 'box' ||
            annot.type === 'circle' ||
            annot.type === 'polygon' ||
            annot.type === 'text'
              ? { fillColor: undefined }
              : null,
          );
          return;
        }
        const parsed = toColorCode(value);
        if (parsed === undefined) return;
        void applyToSelection((annot) =>
          annot.type === 'box' ||
          annot.type === 'circle' ||
          annot.type === 'polygon' ||
          annot.type === 'text'
            ? { fillColor: parsed }
            : null,
        );
      }
    },
  });

  /** box/circle/polygon/textのみ有効な塗りの不透明度。fillOpacity未設定時は、描画側
   * （resolveOpacity）と同じく後方互換用の旧opacityフィールドにフォールバックする（そうしないと、
   * fillOpacity導入以前に保存された既存アノテーションを選択した際、実際の描画とは異なる値が
   * パネルに表示されてしまう） */
  const fillOpacity = computed<number | undefined>({
    get: () => {
      if (mode.value === 'draw') {
        // 描画スタイル（次に描く注釈のスタイル）は常に新規構築されるため旧opacityフィールドを持たない
        const style = editorStore.currentAnnotationStyle;
        return style.type === 'box' ||
          style.type === 'circle' ||
          style.type === 'polygon' ||
          style.type === 'text'
          ? style.fillOpacity
          : undefined;
      }
      if (mode.value === 'selection') {
        return commonValue(editorStore.activeSelection?.annotations ?? [], (a) =>
          a.type === 'box' || a.type === 'circle' || a.type === 'polygon' || a.type === 'text'
            ? (a.fillOpacity ?? a.opacity)
            : undefined,
        );
      }
      return undefined;
    },
    set: (value) => {
      if (value === undefined) return;
      if (mode.value === 'draw') patchDrawStyle({ fillOpacity: value });
      else if (mode.value === 'selection') {
        void applyToSelection((annot) =>
          annot.type === 'box' ||
          annot.type === 'circle' ||
          annot.type === 'polygon' ||
          annot.type === 'text'
            ? { fillOpacity: value }
            : null,
        );
      }
    },
  });

  /** arrow/polylineのみ有効な終端の矢じり形状 */
  const endHead = computed<ArrowHeadType | undefined>({
    get: () => {
      if (mode.value === 'draw') {
        const style = editorStore.currentAnnotationStyle;
        return style.type === 'arrow' || style.type === 'polyline' ? style.endHead : undefined;
      }
      if (mode.value === 'selection') {
        return commonValue(editorStore.activeSelection?.annotations ?? [], (a) =>
          a.type === 'arrow' || a.type === 'polyline' ? a.endHead : undefined,
        );
      }
      return undefined;
    },
    set: (value) => {
      if (value === undefined) return;
      if (mode.value === 'draw') patchDrawStyle({ endHead: value });
      else if (mode.value === 'selection') {
        void applyToSelection((annot) =>
          annot.type === 'arrow' || annot.type === 'polyline' ? { endHead: value } : null,
        );
      }
    },
  });

  /** arrow/polylineのみ有効な始点の矢じり形状（endHeadと対になる。以前は右クリック右ドロワーにのみ存在していた） */
  const startHead = computed<ArrowHeadType | undefined>({
    get: () => {
      if (mode.value === 'draw') {
        const style = editorStore.currentAnnotationStyle;
        return style.type === 'arrow' || style.type === 'polyline' ? style.startHead : undefined;
      }
      if (mode.value === 'selection') {
        return commonValue(editorStore.activeSelection?.annotations ?? [], (a) =>
          a.type === 'arrow' || a.type === 'polyline' ? a.startHead : undefined,
        );
      }
      return undefined;
    },
    set: (value) => {
      if (value === undefined) return;
      if (mode.value === 'draw') patchDrawStyle({ startHead: value });
      else if (mode.value === 'selection') {
        void applyToSelection((annot) =>
          annot.type === 'arrow' || annot.type === 'polyline' ? { startHead: value } : null,
        );
      }
    },
  });

  /** arrow/polylineのみ有効な矢じりサイズ（以前は右ドロワーにのみ存在していた） */
  const headSize = computed<number | undefined>({
    get: () => {
      if (mode.value === 'draw') {
        const style = editorStore.currentAnnotationStyle;
        return style.type === 'arrow' || style.type === 'polyline' ? style.headSize : undefined;
      }
      if (mode.value === 'selection') {
        return commonValue(editorStore.activeSelection?.annotations ?? [], (a) =>
          a.type === 'arrow' || a.type === 'polyline' ? a.headSize : undefined,
        );
      }
      return undefined;
    },
    set: (value) => {
      if (value === undefined) return;
      if (mode.value === 'draw') patchDrawStyle({ headSize: value });
      else if (mode.value === 'selection') {
        void applyToSelection((annot) =>
          annot.type === 'arrow' || annot.type === 'polyline' ? { headSize: value } : null,
        );
      }
    },
  });

  /** textのみ有効なフォント系フィールド（文字色以外。ブランド付き文字列ではないため単純に読み書きできる） */
  function textField<V>(
    key: 'fontFamily' | 'fontSize' | 'fontWeight' | 'textAlign',
  ): WritableComputedRef<V | undefined> {
    return computed<V | undefined>({
      get: () => {
        if (mode.value === 'draw') {
          const style = editorStore.currentAnnotationStyle;
          return style.type === 'text' ? (style[key] as V) : undefined;
        }
        if (mode.value === 'selection') {
          return commonValue(editorStore.activeSelection?.annotations ?? [], (a) =>
            a.type === 'text' ? (a[key] as V) : undefined,
          );
        }
        return undefined;
      },
      set: (value) => {
        if (value === undefined) return;
        if (mode.value === 'draw') patchDrawStyle({ [key]: value });
        else if (mode.value === 'selection') {
          void applyToSelection((annot) => (annot.type === 'text' ? { [key]: value } : null));
        }
      },
    });
  }

  const fontFamily = textField<string>('fontFamily');
  const fontSize = textField<number>('fontSize');
  const fontWeight = textField<number>('fontWeight');
  const textAlign = textField<'left' | 'center' | 'right'>('textAlign');

  /** textのみ有効な文字色 */
  const textColor = computed<string | undefined>({
    get: () => {
      if (mode.value === 'draw') {
        const style = editorStore.currentAnnotationStyle;
        return style.type === 'text' ? style.textColor : undefined;
      }
      if (mode.value === 'selection') {
        return commonValue(editorStore.activeSelection?.annotations ?? [], (a) =>
          a.type === 'text' ? a.textColor : undefined,
        );
      }
      return undefined;
    },
    set: (value) => {
      if (value === undefined) return;
      if (mode.value === 'draw') patchDrawStyle({ textColor: value });
      else if (mode.value === 'selection') {
        const parsed = toColorCode(value);
        if (parsed === undefined) return;
        void applyToSelection((annot) => (annot.type === 'text' ? { textColor: parsed } : null));
      }
    },
  });

  return {
    mode,
    effectiveType,
    applyPresetStyleToSelection,
    relationalOverrideActive,
    color,
    strokeWidth,
    strokeType,
    opacity,
    blendMode,
    fillColor,
    fillOpacity,
    startHead,
    endHead,
    headSize,
    fontFamily,
    fontSize,
    fontWeight,
    textAlign,
    textColor,
  };
}
