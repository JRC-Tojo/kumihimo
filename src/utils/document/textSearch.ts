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
import type { AnnotationStyle, TextItemBox } from 'src/models/document/pdf';
import type { TextSearchMatch, TextSearchOptions } from 'src/models/document/search';
import type { BoundingBox } from 'src/models/common';

/** 元テキストの1文字（UTF-16コード単位）ごとの正規化結果と、正規化後位置→元位置の対応表 */
interface NormalizedText {
  normalized: string;
  /** `normalized`の各位置が、元テキストの何文字目に由来するかを示す対応表 */
  originalIndexOf: number[];
}

/**
 * オプションに従ってテキストを検索用に正規化し、正規化後位置→元位置の対応表とともに返す
 *
 * `distinguishWidth`が偽（既定）の場合、半角・全角の吸収（NFKC正規化）を1文字ずつ行う
 * （`String.prototype.normalize`を文字列全体に対して呼ぶと、結合文字等で長さが変わった際に
 * 元位置との対応が取れなくなるため）。`useRegex`時の大文字小文字は`RegExp`の`i`フラグ側に
 * 任せるため、ここでは折りたたまない
 */
function normalizeForSearch(text: string, options: Partial<TextSearchOptions>): NormalizedText {
  const foldCase = !options.caseSensitive && !options.useRegex;

  if (options.distinguishWidth) {
    // 半角全角を区別する場合は1文字=1文字の対応が保証されるため、単純な変換で済む
    const normalized = foldCase ? text.toLowerCase() : text;
    const originalIndexOf = Array.from({ length: normalized.length }, (_, i) => i);
    return { normalized, originalIndexOf };
  }

  let normalized = '';
  const originalIndexOf: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let part = text[i]!.normalize('NFKC');
    if (foldCase) part = part.toLowerCase();
    for (let j = 0; j < part.length; j++) originalIndexOf.push(i);
    normalized += part;
  }
  return { normalized, originalIndexOf };
}

/**
 * `haystack`内に出現する`query`の（重複しない）出現範囲`[start, end)`一覧を、
 * 常に元テキスト（`haystack`）のインデックスで返す
 *
 * `options.useRegex`が真の場合は`query`を正規表現として解釈する。不正な正規表現
 * （入力途中の状態を含む）はマッチ0件として扱い、例外を投げない
 */
function findOccurrenceRanges(
  haystack: string,
  query: string,
  options: Partial<TextSearchOptions>,
): Array<{ start: number; end: number }> {
  if (query === '') return [];
  const { normalized, originalIndexOf } = normalizeForSearch(haystack, options);

  const toOriginalRange = (normStart: number, normEnd: number): { start: number; end: number } => {
    const start = originalIndexOf[normStart] ?? haystack.length;
    const lastCharOriginal = originalIndexOf[normEnd - 1] ?? haystack.length - 1;
    return { start, end: lastCharOriginal + 1 };
  };

  if (options.useRegex) {
    let regex: RegExp;
    try {
      regex = new RegExp(query, `g${options.caseSensitive ? '' : 'i'}`);
    } catch {
      return [];
    }
    const ranges: Array<{ start: number; end: number }> = [];
    for (;;) {
      const m = regex.exec(normalized);
      if (m === null) break;
      const len = m[0].length;
      if (len === 0) {
        regex.lastIndex++; // ゼロ幅マッチで無限ループしないよう1文字分進める
        continue;
      }
      ranges.push(toOriginalRange(m.index, m.index + len));
    }
    return ranges;
  }

  const normalizedQuery = normalizeForSearch(query, options).normalized;
  if (normalizedQuery === '') return [];
  const ranges: Array<{ start: number; end: number }> = [];
  let from = 0;
  for (;;) {
    const idx = normalized.indexOf(normalizedQuery, from);
    if (idx === -1) break;
    ranges.push(toOriginalRange(idx, idx + normalizedQuery.length));
    from = idx + normalizedQuery.length; // 同じ箇所を重複してマッチさせない
  }
  return ranges;
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

/** 一覧表示のスニペットとして前後に取得する文脈の最大文字数 */
const MAX_CONTEXT_CHARS = 24;

/**
 * 論理テキストの各文字が何行目（同じ行とみなせるテキストアイテムの集まり）に属するかを求める
 *
 * pdf.jsのテキストアイテムには明示的な行区切り文字がないため、隣接するアイテムのY座標が
 * 大きく変わった箇所を行の境界とみなす近似（`アイテム高さの半分`を閾値とする）で判定する。
 * 一覧表示のスニペット（`contextBefore`/`contextAfter`）がこの境界をまたいで表示されないようにする
 */
function buildLineIndex(positioned: PositionedItem[], textLength: number): number[] {
  const lineIndex = new Array<number>(textLength);
  let currentLine = 0;
  let prevItem: TextItemBox | undefined;
  for (const { item, start, end } of positioned) {
    if (prevItem !== undefined) {
      const threshold = Math.max(prevItem.height, item.height) / 2;
      if (Math.abs(item.y - prevItem.y) > threshold) currentLine++;
    }
    for (let i = start; i < end; i++) lineIndex[i] = currentLine;
    prevItem = item;
  }
  return lineIndex;
}

/**
 * マッチ範囲`[start, end)`の前後の文脈を、同じ行の範囲・`MAX_CONTEXT_CHARS`文字数を上限に取得する
 *
 * 一覧表示（コンテナ横断検索の結果リスト）でマッチ箇所を周辺文字とともにスニペット表示する用途
 */
function extractContext(
  text: string,
  lineIndex: number[],
  start: number,
  end: number,
): { before: string; after: string } {
  const startLine = lineIndex[start] ?? lineIndex[start - 1] ?? 0;
  const endLine = lineIndex[end - 1] ?? startLine;

  let beforeStart = start;
  while (
    beforeStart > 0 &&
    start - beforeStart < MAX_CONTEXT_CHARS &&
    lineIndex[beforeStart - 1] === startLine
  ) {
    beforeStart--;
  }

  let afterEnd = end;
  while (afterEnd < text.length && afterEnd - end < MAX_CONTEXT_CHARS && lineIndex[afterEnd] === endLine) {
    afterEnd++;
  }

  return { before: text.slice(beforeStart, start), after: text.slice(end, afterEnd) };
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
 * 一意なキーを生成できるようにする。`options`省略時は従来どおり（大文字小文字を区別せず、
 * 半角全角は区別し、正規表現は使わない）
 */
export function findMatchesOnPage(
  items: TextItemBox[],
  pageNumber: number,
  query: string,
  options: Partial<TextSearchOptions> = {},
): TextSearchMatch[] {
  if (query === '') return [];
  const { text, positioned } = buildLogicalText(items);
  const ranges = findOccurrenceRanges(text, query, options);
  const lineIndex = buildLineIndex(positioned, text.length);

  return ranges.map(({ start, end }, matchIndex) => {
    const { before, after } = extractContext(text, lineIndex, start, end);
    return {
      pageNumber,
      matchIndex,
      text: text.slice(start, end),
      contextBefore: before,
      contextAfter: after,
      boxes: boxesForRange(positioned, start, end),
    };
  });
}

/**
 * 検索マッチ1件を一意に識別するDOM要素id（ハイライト矩形・スクロール先の特定に使う）
 */
export function searchMatchDomId(match: TextSearchMatch): string {
  return `search-match-p${match.pageNumber}-m${match.matchIndex}`;
}

/**
 * テキストボックスアノテーションの内容を、`TextItemBox`と同じ形（位置・サイズ付き）で
 * ページ番号ごとにグルーピングして返す
 *
 * PDF自体のテキスト（`extractTextBlocksByPageFromDoc`）と同じ座標系（スケール1、左上原点）で
 * `x`/`y`/`width`/`height`を保持しているため、`findMatchesOnPage`へPDFテキストのアイテム一覧と
 * 単純に連結して渡すだけで、既存のハイライト表示・ページ内スクロールの仕組みをそのまま使い回せる
 * （アノテーションのテキストも検索対象に含める、issue由来の要望への対応）
 */
export function annotationTextItemsByPage(
  annotations: AnnotationStyle[],
): Map<number, TextItemBox[]> {
  const byPage = new Map<number, TextItemBox[]>();
  for (const annotation of annotations) {
    if (annotation.type !== 'text' || annotation.text === '') continue;
    const items = byPage.get(annotation.pageNumber) ?? [];
    items.push({
      text: annotation.text,
      x: annotation.x,
      y: annotation.y,
      width: annotation.width,
      height: annotation.height,
    });
    byPage.set(annotation.pageNumber, items);
  }
  return byPage;
}
