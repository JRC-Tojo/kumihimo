/**
 * 文書内テキスト検索のマッチング処理（pdf.js非依存の純粋関数群）
 *
 * `extractTextBlocksByPageFromDoc`（`src/repositories/document/pdf.ts`）が返す位置情報付き
 * テキストアイテム（`TextItemBox`）とクエリ文字列を受け取り、ページ内の全アイテムを連結した
 * 「論理テキスト」に対して出現箇所を文字インデックスベースで求める。pdf.jsのテキストアイテムは
 * 行・単語のまとまり単位（文字単位ではない）で提供されるため、クエリがアイテムの境界をまたぐ
 * ケース（例: "cathedral"が"cathe"と"dral"の2アイテムに分かれている）にも対応する必要がある。
 * 求めたマッチ範囲は、寄与した各アイテムへ跨り分を割り戻し、アイテムのバウンディングボックスに
 * 対して文字位置に比例したサブ矩形（アイテム内で文字幅が一様であると仮定した近似値。
 * `extractTextByAnnot`が抽出用に採用している考え方と同じ）を算出する
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

/** 論理テキスト中で、1件のテキストアイテムが占める文字範囲（`[start, end)`） */
interface PositionedItem {
  item: TextItemBox;
  start: number;
  end: number;
}

/**
 * ページ内の全テキストアイテムを連結した論理テキストと、各アイテムがその中で占める文字範囲を求める
 *
 * アイテム間に区切り文字は挿入しない（pdf.jsは空白そのものも独立したテキストアイテム、または
 * 隣接アイテムの`str`の一部として提供するため、単純連結が実際の見た目の文字列に対応する）
 */
function buildLogicalText(items: TextItemBox[]): { text: string; positioned: PositionedItem[] } {
  let text = '';
  const positioned: PositionedItem[] = [];
  for (const item of items) {
    const start = text.length;
    text += item.text;
    positioned.push({ item, start, end: start + item.text.length });
  }
  return { text, positioned };
}

/**
 * 論理テキスト上のマッチ範囲`[startOffset, endOffset)`を、寄与した各アイテムのサブ矩形へ割り戻す
 *
 * 範囲が複数アイテムにまたがる場合、アイテムごとに重なる部分のみを切り出した矩形を返す
 * （＝戻り値は2件以上になり得る）。文字幅は1件目のテキストアイテムマッチと同じく
 * `アイテム幅 ÷ 文字数`の一様近似
 */
function boxesForRange(
  positioned: PositionedItem[],
  startOffset: number,
  endOffset: number,
): BoundingBox[] {
  const boxes: BoundingBox[] = [];
  for (const { item, start, end } of positioned) {
    if (item.text.length === 0) continue;
    const overlapStart = Math.max(startOffset, start);
    const overlapEnd = Math.min(endOffset, end);
    if (overlapStart >= overlapEnd) continue; // このアイテムはマッチ範囲と重ならない

    const charWidth = item.width / item.text.length;
    const localStart = overlapStart - start;
    const localEnd = overlapEnd - start;
    boxes.push({
      x: item.x + localStart * charWidth,
      y: item.y,
      width: (localEnd - localStart) * charWidth,
      height: item.height,
    });
  }
  return boxes;
}

/**
 * 1ページ分のテキストアイテム一覧から、クエリにマッチする全箇所を`TextSearchMatch`として求める
 *
 * アイテムを連結した論理テキストに対して検索するため、クエリがアイテムの境界をまたいでいても
 * マッチする。ページ内での出現順に振った通し番号を`matchIndex`とし、`searchMatchDomId`が
 * 一意なキーを生成できるようにする
 */
export function findMatchesOnPage(
  items: TextItemBox[],
  pageNumber: number,
  query: string,
  options?: FindMatchesOptions,
): TextSearchMatch[] {
  if (query === '') return [];
  const caseSensitive = options?.caseSensitive ?? false;
  const { text, positioned } = buildLogicalText(items);
  const occurrences = findAllOccurrences(text, query, caseSensitive);

  return occurrences.map((startOffset, matchIndex) => {
    const endOffset = startOffset + query.length;
    return {
      pageNumber,
      matchIndex,
      text: text.slice(startOffset, endOffset),
      boxes: boxesForRange(positioned, startOffset, endOffset),
    };
  });
}

/**
 * 検索マッチ1件を一意に識別するDOM要素id（ハイライト矩形・スクロール先の特定に使う）
 */
export function searchMatchDomId(match: TextSearchMatch): string {
  return `search-match-p${match.pageNumber}-m${match.matchIndex}`;
}
