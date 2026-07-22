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
import { useAnnotationHistory } from './useAnnotationHistory';
import type { DrawingAnnotationType } from 'src/models/docPage';
import {
  ColorCode,
  type AnnotationStyle,
  type ArrowHeadType,
  type StrokeType,
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
  const history = useAnnotationHistory();

  const mode = computed<StylePanelMode>(() => {
    if (editorStore.activeAnnotationType !== undefined) return 'draw';
    if ((editorStore.activeSelection?.annotations.length ?? 0) > 0) return 'selection';
    return 'none';
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

  function patchDrawStyle(patch: Record<string, unknown>): void {
    editorStore.currentAnnotationStyle = {
      ...editorStore.currentAnnotationStyle,
      ...patch,
    };
  }

  /** 色以外の全種別共通フィールドを、モードに応じたget/setで統一的に扱うwritable computedを作る */
  function universalField<V>(
    drawKey: 'strokeWidth' | 'strokeType' | 'strokeOpacity',
    selectionKey: 'strokeWidth' | 'strokeType' | 'strokeOpacity',
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
  const opacity = universalField<number>('strokeOpacity', 'strokeOpacity');

  /**
   * 配置済みアノテーション（AnnotationStyle）の色系フィールドはColorCode（ブランド付き文字列）の
   * ため、カラーピッカーから来る生の文字列を検証してから適用する（不正な値は無視する）
   */
  function toColorCode(value: string): ColorCode | undefined {
    const parsed = ColorCode.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  }

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
      if (value === undefined) return;
      if (mode.value === 'draw') patchDrawStyle({ strokeColor: value });
      else if (mode.value === 'selection') {
        const parsed = toColorCode(value);
        if (parsed === undefined) return;
        void applyToSelection(() => ({ color: parsed }));
      }
    },
  });

  /** box/circle/polygonのみ有効な塗り色 */
  const fillColor = computed<string | undefined>({
    get: () => {
      if (mode.value === 'draw') {
        const style = editorStore.currentAnnotationStyle;
        return style.type === 'box' || style.type === 'circle' || style.type === 'polygon'
          ? style.fillColor
          : undefined;
      }
      if (mode.value === 'selection') {
        return commonValue(editorStore.activeSelection?.annotations ?? [], (a) =>
          a.type === 'box' || a.type === 'circle' || a.type === 'polygon' ? a.fillColor : undefined,
        );
      }
      return undefined;
    },
    set: (value) => {
      if (value === undefined) return;
      if (mode.value === 'draw') patchDrawStyle({ fillColor: value });
      else if (mode.value === 'selection') {
        const parsed = toColorCode(value);
        if (parsed === undefined) return;
        void applyToSelection((annot) =>
          annot.type === 'box' || annot.type === 'circle' || annot.type === 'polygon'
            ? { fillColor: parsed }
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

  /** textのみ有効なフォント系フィールド（文字色以外。ブランド付き文字列ではないため単純に読み書きできる） */
  function textField<V>(key: 'fontFamily' | 'fontSize'): WritableComputedRef<V | undefined> {
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
    color,
    strokeWidth,
    strokeType,
    opacity,
    fillColor,
    endHead,
    fontFamily,
    fontSize,
    textColor,
  };
}
