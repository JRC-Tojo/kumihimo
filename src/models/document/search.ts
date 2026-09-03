import z from 'zod';
import { ContainerElementFile } from 'src/models/container';

/**
 * 文書内テキスト検索の1マッチ結果
 *
 * `itemIndex`はページ内で何番目のテキストアイテム（`TextItemBox`）内のマッチかを、
 * `matchIndexInItem`は同一アイテム内で何番目の出現かを表す（同じアイテム内でクエリが複数回
 * 出現する場合の一意なキーとして、DOM要素のidやactiveMatch比較に使う）。
 * `box`はスケール1（`getViewport({scale:1})`基準）での左上原点バウンディングボックスで、
 * 表示側は現在のズーム倍率を掛けて画面座標に変換する
 */
export const TextSearchMatch = z.object({
  pageNumber: z.number().int().positive(),
  itemIndex: z.number().int().nonnegative(),
  matchIndexInItem: z.number().int().nonnegative(),
  /** マッチしたテキストアイテム全体の文字列（デバッグ・一覧表示のスニペット用） */
  text: z.string(),
  box: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
});
export type TextSearchMatch = z.infer<typeof TextSearchMatch>;

/**
 * コンテナ横断検索における、1文書分の検索結果
 */
export const ContainerTextSearchResult = z.object({
  file: ContainerElementFile,
  matches: z.array(TextSearchMatch),
});
export type ContainerTextSearchResult = z.infer<typeof ContainerTextSearchResult>;
