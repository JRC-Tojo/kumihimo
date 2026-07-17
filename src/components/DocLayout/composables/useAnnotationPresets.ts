/**
 * アノテーションプリセット一覧（`AppSettings.tools.annotations`）に対する純粋な操作をまとめたユーティリティ
 *
 * プリセットは全種別分を1つの配列にまとめて保存するが、プリセットバーは種別ごとにフィルタした
 * 部分列だけをドラッグ並び替えの対象にする。並び替え結果を全体配列へ書き戻す際、
 * 他種別のプリセットの位置を変えないようにするための変換をここに切り出す
 */

import type { AnnotationTool, DrawingAnnotationType } from 'src/models/docPage';

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
