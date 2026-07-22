/**
 * アノテーションプリセット一覧（`AppSettings.tools.annotations`）に対する純粋な操作をまとめたユーティリティ
 *
 * プリセットは全種別分を1つの配列にまとめて保存するが、プリセットバーは種別ごとにフィルタした
 * 部分列だけをドラッグ並び替えの対象にする。並び替え結果を全体配列へ書き戻す際、
 * 他種別のプリセットの位置を変えないようにするための変換をここに切り出す
 */

import type { AnnotationTool, DrawingAnnotationStyle, DrawingAnnotationType } from 'src/models/docPage';
import { ColorCode, type AnnotationStyle } from 'src/models/document/pdf';

/** 未検証の文字列をColorCode（ブランド付き文字列）へ変換する。不正な値はundefinedを返す */
function toColorCode(value: string | undefined): ColorCode | undefined {
  if (value === undefined) return undefined;
  const parsed = ColorCode.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * 指定種別のプリセットだけを並び替えた結果を、全体配列に書き戻す
 * @param all 全種別分のプリセット配列（現在の並び順）
 * @param type 並び替え対象の種別
 * @param reordered `all`から`type`のプリセットだけを抽出し、並び替えた配列（要素数は一致している必要がある）
 */
export function reorderPresetsOfType(
  all: AnnotationTool[],
  type: DrawingAnnotationType,
  reordered: AnnotationTool[],
): AnnotationTool[] {
  let i = 0;
  return all.map((item) => (item.style.type === type ? (reordered[i++] ?? item) : item));
}

/**
 * プリセットのスタイル（`DrawingAnnotationStyle`）を、選択中アノテーション群への適用patchへ変換する
 *
 * 対象アノテーションの種別がpresetの種別と一致しない場合はnullを返し、そのアノテーションは
 * スキップする（`useAnnotationHistory.buildRegisterManyItems`のbuilding引数と同じ規約）。
 * フィールド名の差異（preset側は`strokeColor`、配置済み側は`color`）はここで吸収する
 */
export function buildPresetApplyPatch(
  preset: DrawingAnnotationStyle,
): (annot: AnnotationStyle) => Partial<AnnotationStyle> | null {
  return (annot) => {
    if (annot.type !== preset.type) return null;

    const color = toColorCode(preset.strokeColor);
    if (color === undefined) return null;

    const common = {
      color,
      strokeWidth: preset.strokeWidth,
      strokeType: preset.strokeType,
      strokeOpacity: preset.strokeOpacity,
      blendMode: preset.blendMode,
    };

    switch (preset.type) {
      case 'box':
      case 'circle':
      case 'polygon':
        return {
          ...common,
          fillColor: toColorCode(preset.fillColor),
          fillOpacity: preset.fillOpacity,
        };
      case 'arrow':
      case 'polyline':
        return {
          ...common,
          startHead: preset.startHead,
          endHead: preset.endHead,
          headSize: preset.headSize,
        };
      case 'text': {
        const textColor = toColorCode(preset.textColor);
        if (textColor === undefined) return null;
        return {
          ...common,
          textColor,
          fontFamily: preset.fontFamily,
          fontSize: preset.fontSize,
          fontWeight: preset.fontWeight,
          fillColor: toColorCode(preset.fillColor),
          fillOpacity: preset.fillOpacity,
        };
      }
      case 'line':
        return common;
    }
  };
}

/**
 * 配置済みアノテーションのスタイルを、新規プリセット・プリセット上書き用の`DrawingAnnotationStyle`へ変換する
 *
 * 位置・サイズ・頂点座標などの幾何情報は含まず、スタイルに関するフィールドのみを抽出する
 */
export function annotationStyleToPresetStyle(annot: AnnotationStyle): DrawingAnnotationStyle {
  const common = {
    strokeColor: annot.color,
    strokeWidth: annot.strokeWidth ?? 2,
    strokeType: annot.strokeType ?? ('solid' as const),
    strokeOpacity: annot.strokeOpacity ?? annot.opacity ?? 1,
    blendMode: annot.blendMode ?? ('normal' as const),
  };

  switch (annot.type) {
    case 'box':
    case 'circle':
    case 'polygon':
      return {
        ...common,
        type: annot.type,
        fillColor: annot.fillColor ?? annot.color,
        fillPattern: annot.fillColor ? 'solid' : 'none',
        fillOpacity: annot.fillOpacity ?? 1,
      };
    case 'arrow':
    case 'polyline':
      return {
        ...common,
        type: annot.type,
        startHead: annot.startHead,
        endHead: annot.endHead,
        headSize: annot.headSize ?? 10,
      };
    case 'text':
      return {
        ...common,
        type: 'text',
        textColor: annot.textColor,
        fontWeight: annot.fontWeight,
        fontFamily: annot.fontFamily,
        fontSize: annot.fontSize,
        textAlign: annot.textAlign,
        fillColor: annot.fillColor ?? annot.color,
        fillPattern: annot.fillColor ? 'solid' : 'none',
        fillOpacity: annot.fillOpacity ?? 1,
      };
    case 'line':
      return { ...common, type: 'line' };
  }
}
