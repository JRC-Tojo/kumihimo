/**
 * 文書内テキスト検索のマッチング処理（pdf.js非依存の純粋関数群）
 *
 * `extractTextBlocksByPageFromDoc`（`src/repositories/document/pdf.ts`）が返す位置情報付き
 * テキストアイテム（`TextItemBox`）とクエリ文字列を受け取り、各アイテム内での出現箇所を
 * 文字インデックスベースで求め、アイテムのバウンディングボックスに対して文字位置に比例した
 * サブ矩形（アイテム内で文字幅が一様であると仮定した近似値）を算出する。
 *
 * pdf.jsのテキストアイテムは行・単語のまとまり単位（文字単位ではない）で提供されるため、
 * 厳密なグリフ幅ではなく「アイテム幅 ÷ 文字数」による近似で十分実用的なハイライト位置になる
 * （`extractTextByAnnot`が抽出用に採用している考え方と同じ）
 */
import type { TextItemBox } from 'src/models/document/pdf';
import type { TextSearchMatch } from 'src/models/document/search';
import type { BoundingBox } from 'src/models/common';

export interface FindMatchesOptions {
  /** 大文字小文字を区別するかどうか（既定: 区別しない） */
  caseSensitive?: boolean;
}

/**
 * `haystack`内に出現する`needle`の（重複しない）開始インデックス一覧を返す
 *
 * `needle`が空文字の場合は無限マッチになってしまうため空配列を返す
 */
function findAllOccurrences(haystack: string, needle: string, caseSensitive: boolean): number[] {
  if (needle === '') return [];
  const h = caseSensitive ? haystack : haystack.toLowerCase();
  const n = caseSensitive ? needle : needle.toLowerCase();
  const indices: number[] = [];
  let from = 0;
  for (;;) {
    const idx = h.indexOf(n, from);
    if (idx === -1) break;
    indices.push(idx);
    from = idx + n.length; // 同じ箇所を重複してマッチさせない
  }
  return indices;
}

/**
 * 1件のテキストアイテム内でのマッチ箇所を、文字位置に比例したサブ矩形付きで求める
 *
 * 文字幅は`アイテム幅 ÷ 文字数`で一様と仮定する（UTF-16コード単位基準。サロゲートペアの
 * 文字幅もこの近似の範囲では実用上問題にならない）
 */
export function findMatchesInItem(
  item: TextItemBox,
  query: string,
  options: FindMatchesOptions = {},
): BoundingBox[] {
  if (item.text.length === 0 || query === '') return [];
  const caseSensitive = options.caseSensitive ?? false;
  const occurrences = findAllOccurrences(item.text, query, caseSensitive);
  if (occurrences.length === 0) return [];

  const charWidth = item.width / item.text.length;
  return occurrences.map((startIndex) => ({
    x: item.x + startIndex * charWidth,
    y: item.y,
    width: Math.min(query.length, item.text.length - startIndex) * charWidth,
    height: item.height,
  }));
}

/**
 * 1ページ分のテキストアイテム一覧から、クエリにマッチする全箇所を`TextSearchMatch`として求める
 *
 * `items`の配列インデックスを`itemIndex`として、同一アイテム内の複数マッチには
 * `matchIndexInItem`を振ることで、`searchMatchDomId`が一意なキーを生成できるようにする
 */
export function findMatchesOnPage(
  items: TextItemBox[],
  pageNumber: number,
  query: string,
  options?: FindMatchesOptions,
): TextSearchMatch[] {
  const matches: TextSearchMatch[] = [];
  items.forEach((item, itemIndex) => {
    const boxes = findMatchesInItem(item, query, options);
    boxes.forEach((box, matchIndexInItem) => {
      matches.push({
        pageNumber,
        itemIndex,
        matchIndexInItem,
        text: item.text,
        box,
      });
    });
  });
  return matches;
}

/**
 * 検索マッチ1件を一意に識別するDOM要素id（ハイライト矩形・スクロール先の特定に使う）
 */
export function searchMatchDomId(match: TextSearchMatch): string {
  return `search-match-p${match.pageNumber}-i${match.itemIndex}-m${match.matchIndexInItem}`;
}
