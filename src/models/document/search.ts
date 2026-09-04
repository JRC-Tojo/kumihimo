import z from 'zod';
import { ContainerElementFile } from 'src/models/container';

/**
 * 文書内テキスト検索・コンテナ横断検索に共通の検索オプション
 *
 * いずれも既定値は`false`＝緩い（区別しない）一致とし、`true`＝厳密な一致という向きで統一する
 * （検索バーのトグルボタンは「押している状態＝trueの項目名の動作が有効」という一貫した意味になる）。
 * `caseSensitive`は大文字小文字を区別するかどうか。`distinguishWidth`は半角・全角の違いを
 * 区別するかどうか（既定はNFKC正規化で吸収し区別しない）。`useRegex`はクエリをリテラル文字列では
 * なく正規表現として解釈するかどうか。`useRegex`が真の場合、`caseSensitive`は`RegExp`の`i`フラグ
 * として適用される
 */
export const TextSearchOptions = z.object({
  caseSensitive: z.boolean().default(false),
  distinguishWidth: z.boolean().default(false),
  useRegex: z.boolean().default(false),
});
export type TextSearchOptions = z.infer<typeof TextSearchOptions>;

/**
 * 文書内テキスト検索の1マッチ結果
 *
 * `matchIndex`はページ内で何番目のマッチかを表す通し番号（DOM要素のidやactiveMatch比較に使う
 * 一意なキー）。マッチはページ内のテキストアイテムを連結した論理テキストに対して探索するため、
 * 複数のテキストアイテムにまたがる場合がある（`boxes`が2件以上になる）。
 * `boxes`はスケール1（`getViewport({scale:1})`基準）での左上原点バウンディングボックス一覧
 * （マッチに寄与した各テキストアイテムの部分矩形）で、表示側は現在のズーム倍率を掛けて
 * 画面座標に変換したうえですべて描画する。`contextBefore`/`contextAfter`はマッチ箇所の
 * 前後の文脈（一覧表示のスニペット用）で、マッチと同じ行（テキストアイテムのY座標が近い範囲）
 * を超えては取得しない
 */
export const TextSearchMatch = z.object({
  pageNumber: z.number().int().positive(),
  matchIndex: z.number().int().nonnegative(),
  /** マッチした文字列そのもの（一覧表示のハイライト対象） */
  text: z.string(),
  /** マッチ直前の文脈（同じ行の範囲のみ、一覧表示のスニペット用） */
  contextBefore: z.string(),
  /** マッチ直後の文脈（同じ行の範囲のみ、一覧表示のスニペット用） */
  contextAfter: z.string(),
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
