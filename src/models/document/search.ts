import z from 'zod';
import { ContainerElementFile } from 'src/models/container';

/**
 * 文書内テキスト検索の1マッチ結果
 *
 * `matchIndex`はページ内で何番目のマッチかを表す通し番号（DOM要素のidやactiveMatch比較に使う
 * 一意なキー）。マッチはページ内のテキストアイテムを連結した論理テキストに対して探索するため、
 * 複数のテキストアイテムにまたがる場合がある（`boxes`が2件以上になる）。
 * `boxes`はスケール1（`getViewport({scale:1})`基準）での左上原点バウンディングボックス一覧
 * （マッチに寄与した各テキストアイテムの部分矩形）で、表示側は現在のズーム倍率を掛けて
 * 画面座標に変換したうえですべて描画する
 */
export const TextSearchMatch = z.object({
  pageNumber: z.number().int().positive(),
  matchIndex: z.number().int().nonnegative(),
  /** マッチした文字列そのもの（デバッグ・一覧表示のスニペット用） */
  text: z.string(),
  boxes: z
    .array(
      z.object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
      }),
    )
    .min(1),
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
