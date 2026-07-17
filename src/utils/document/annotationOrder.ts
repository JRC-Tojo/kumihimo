/**
 * アノテーションの重ね順（描画順）に関する純粋な計算処理をまとめたユーティリティ
 *
 * `AnnotationStyle.zIndex`は明示的に重ね順操作をした注釈にのみ設定される。
 * 未設定の注釈は`createdAt`（作成順）を実効的な重ね順キーとして扱うことで、
 * 既存データ（zIndex未設定）は現状の見た目（作成順）を維持しつつ、
 * 「最前面へ」等の操作をした注釈だけが明示的なzIndexで上書きされるようにする。
 */

import dayjs from 'dayjs';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';

/** 重ね順操作の種別。front/backは最前面・最背面へ、forward/backwardは1つ前面・背面へ移動する */
export type LayerOrderAction = 'front' | 'forward' | 'backward' | 'back';

/** 注釈の実効的な重ね順キーを返す。zIndex未設定の場合はcreatedAtの時刻をキーとして使う */
export function getAnnotationSortKey(annotation: AnnotationStyle): number {
  return annotation.zIndex ?? dayjs(annotation.createdAt).valueOf();
}

/**
 * 指定した注釈を対象に、重ね順操作後の新しいzIndexを算出する
 *
 * 同一ページ内の注釈群をソートキー昇順に並べ、対象の現在位置をもとに
 * front: 最大値+1、back: 最小値-1、forward/backward: 1つ前面/背面の要素との中間値を返す。
 * 対象がすでに最前面/最背面の場合、forward/backwardはfront/backと同じ計算になる。
 * 対象注釈が見つからない場合はnullを返す。
 */
export function computeReorderedZIndex(
  annotations: AnnotationStyle[],
  targetId: AnnotationID,
  action: LayerOrderAction,
): number | null {
  const target = annotations.find((a) => a.id === targetId);
  if (!target) return null;

  const sorted = [...annotations].sort(
    (a, b) => getAnnotationSortKey(a) - getAnnotationSortKey(b),
  );
  const index = sorted.findIndex((a) => a.id === targetId);
  const keys = sorted.map((a) => getAnnotationSortKey(a));
  const minKey = keys[0]!;
  const maxKey = keys[keys.length - 1]!;

  switch (action) {
    case 'front':
      return maxKey + 1;
    case 'back':
      return minKey - 1;
    case 'forward': {
      // すでに最前面の場合はそれ以上前に出せないため現状維持
      if (index >= sorted.length - 1) return getAnnotationSortKey(target);
      const nextKey = keys[index + 1]!;
      const afterNextKey = index + 2 < keys.length ? keys[index + 2]! : nextKey + 1;
      return (nextKey + afterNextKey) / 2;
    }
    case 'backward': {
      // すでに最背面の場合はそれ以上後ろに下げられないため現状維持
      if (index <= 0) return getAnnotationSortKey(target);
      const prevKey = keys[index - 1]!;
      const beforePrevKey = index - 2 >= 0 ? keys[index - 2]! : prevKey - 1;
      return (prevKey + beforePrevKey) / 2;
    }
  }
}
