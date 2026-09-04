import { describe, expect, it } from 'bun:test';
import type { AnnotationStyle, TextItemBox } from 'src/models/document/pdf';
import { BoxAnnotationStyle, TextAnnotationStyle } from 'src/models/document/pdf';
import { annotationTextItemsByPage, findMatchesOnPage, searchMatchDomId } from '../textSearch';

const baseAnnotationFields = {
  id: '00000000-0000-4000-8000-000000000000',
  color: '#000000',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  textColor: '#000000',
} as const;

function box(text: string, overrides: Partial<TextItemBox> = {}): TextItemBox {
  return { text, x: 0, y: 0, width: text.length * 10, height: 10, ...overrides };
}

describe('findMatchesOnPage', () => {
  it('クエリが1回だけ出現する場合、文字位置に比例したサブ矩形を1件返す', () => {
    const items = [box('Hello World')]; // charWidth = 110/11 = 10
    const matches = findMatchesOnPage(items, 3, 'World');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      pageNumber: 3,
      matchIndex: 0,
      text: 'World',
      boxes: [{ x: 60, y: 0, width: 50, height: 10 }],
    });
  });

  it('大文字小文字を区別しない（既定）', () => {
    const items = [box('Hello World')];
    expect(findMatchesOnPage(items, 1, 'world')).toHaveLength(1);
  });

  it('caseSensitive: trueの場合は大文字小文字が一致しないとマッチしない', () => {
    const items = [box('Hello World')];
    expect(findMatchesOnPage(items, 1, 'world', { caseSensitive: true })).toHaveLength(0);
    expect(findMatchesOnPage(items, 1, 'World', { caseSensitive: true })).toHaveLength(1);
  });

  it('同一アイテム内に複数回出現する場合、重複しない出現箇所をすべて返す', () => {
    const items = [box('ababab')]; // charWidth = 60/6 = 10
    const matches = findMatchesOnPage(items, 1, 'ab');
    expect(matches).toHaveLength(3);
    expect(matches.map((m) => m.boxes[0]?.x)).toEqual([0, 20, 40]);
  });

  it('マッチが重複しないよう、消費済みの範囲から次を探す（"aaa"にクエリ"aa"は1回のみ）', () => {
    const items = [box('aaa')];
    expect(findMatchesOnPage(items, 1, 'aa')).toHaveLength(1);
  });

  it('クエリが空文字の場合はマッチしない', () => {
    const items = [box('Hello World')];
    expect(findMatchesOnPage(items, 1, '')).toHaveLength(0);
  });

  it('アイテムのテキストが空文字の場合はマッチしない', () => {
    const items = [box('', { width: 0 })];
    expect(findMatchesOnPage(items, 1, 'a')).toHaveLength(0);
  });

  it('マッチしないクエリでは空配列を返す', () => {
    const items = [box('Hello World')];
    expect(findMatchesOnPage(items, 1, 'xyz')).toHaveLength(0);
  });

  it('アイテム自身のx/y原点を基準に矩形を算出する', () => {
    const items = [box('Hello World', { x: 100, y: 50 })];
    const matches = findMatchesOnPage(items, 1, 'Hello');
    expect(matches[0]?.boxes).toEqual([{ x: 100, y: 50, width: 50, height: 10 }]);
  });

  it('複数アイテムにまたがるマッチをすべてpageNumber付きで返す', () => {
    const items = [box('apple'), box('banana apple')];
    const matches = findMatchesOnPage(items, 3, 'apple');
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ pageNumber: 3, matchIndex: 0 });
    expect(matches[1]).toMatchObject({ pageNumber: 3, matchIndex: 1 });
  });

  it('同一ページ内の複数マッチにはmatchIndexを連番で振る', () => {
    const items = [box('ababab')];
    const matches = findMatchesOnPage(items, 1, 'ab');
    expect(matches.map((m) => m.matchIndex)).toEqual([0, 1, 2]);
  });

  it('マッチが1件もない場合は空配列を返す', () => {
    const items = [box('apple'), box('banana')];
    expect(findMatchesOnPage(items, 1, 'xyz')).toEqual([]);
  });

  it('クエリが隣接する2アイテムの境界をまたぐ場合でもマッチし、寄与した両アイテムの矩形を返す', () => {
    // 'cathe' (item0) + 'dral' (item1) = 'cathedral'。クエリ'thedra'はitem0の末尾3文字と
    // item1の先頭3文字にまたがる
    const item0 = box('cathe', { x: 0 }); // charWidth = 50/5 = 10
    const item1 = box('dral', { x: 50 }); // charWidth = 40/4 = 10
    const matches = findMatchesOnPage([item0, item1], 1, 'thedra');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.text).toBe('thedra');
    // item0側: 'the' (index2-4, x=20〜50), item1側: 'dra' (index0-2, x=50〜80)
    expect(matches[0]?.boxes).toEqual([
      { x: 20, y: 0, width: 30, height: 10 },
      { x: 50, y: 0, width: 30, height: 10 },
    ]);
  });

  it('境界をまたがない通常のクエリでは、単一アイテムの矩形のみ返す', () => {
    const item0 = box('cathe', { x: 0 });
    const item1 = box('dral', { x: 50 });
    const matches = findMatchesOnPage([item0, item1], 1, 'cat');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.boxes).toHaveLength(1);
  });
});

describe('findMatchesOnPage（contextBefore/contextAfter: 一覧表示用スニペット）', () => {
  it('マッチ前後の同一行内の文字列を返す', () => {
    const items = [box('the quick brown fox jumps')];
    const matches = findMatchesOnPage(items, 1, 'brown');
    expect(matches[0]?.contextBefore).toBe('the quick ');
    expect(matches[0]?.contextAfter).toBe(' fox jumps');
  });

  it('Y座標が異なる（＝改行された）アイテムをまたいでは文脈を取得しない', () => {
    // item0とitem1はY座標が離れており別行とみなされる
    const item0 = box('foo bar', { y: 0, height: 10 });
    const item1 = box('bar baz', { y: 20, height: 10 });
    const matches = findMatchesOnPage([item0, item1], 1, 'bar');
    expect(matches).toHaveLength(2);
    // item0内の'bar'（末尾）: 直後に文字がなく、改行先item1へは跨がない
    expect(matches[0]?.contextBefore).toBe('foo ');
    expect(matches[0]?.contextAfter).toBe('');
    // item1内の'bar'（先頭）: 直前に文字がなく、改行元item0へは跨がない
    expect(matches[1]?.contextBefore).toBe('');
    expect(matches[1]?.contextAfter).toBe(' baz');
  });

  it('文脈は最大24文字まで（それを超える分は切り詰める）', () => {
    const items = [box(`${'a'.repeat(40)}TARGET${'b'.repeat(40)}`)];
    const matches = findMatchesOnPage(items, 1, 'TARGET');
    expect(matches[0]?.contextBefore).toBe('a'.repeat(24));
    expect(matches[0]?.contextAfter).toBe('b'.repeat(24));
  });
});

describe('searchMatchDomId', () => {
  it('page/matchIndexの組から一意な文字列を生成する', () => {
    const id = searchMatchDomId({
      pageNumber: 2,
      matchIndex: 5,
      text: 'foo',
      contextBefore: '',
      contextAfter: '',
      boxes: [{ x: 0, y: 0, width: 0, height: 0 }],
    });
    expect(id).toBe('search-match-p2-m5');
  });
});

describe('findMatchesOnPage（distinguishWidth: 半角全角を区別する）', () => {
  it('既定（distinguishWidth未指定）では全角・半角の違いを無視してマッチする', () => {
    const items = [box('ABC１２３')]; // 全角数字
    const matches = findMatchesOnPage(items, 1, '123');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.text).toBe('１２３');
  });

  it('distinguishWidth: trueの場合、全角と半角は別物としてマッチしない', () => {
    const items = [box('ABC１２３')];
    expect(findMatchesOnPage(items, 1, '123', { distinguishWidth: true })).toHaveLength(0);
  });

  it('distinguishWidth: trueでも、表記が完全一致すればマッチする', () => {
    const items = [box('ABC123')];
    const matches = findMatchesOnPage(items, 1, '123', { distinguishWidth: true });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.text).toBe('123');
  });
});

describe('findMatchesOnPage（useRegex: 正規表現検索）', () => {
  it('正規表現パターンにマッチする箇所を返す', () => {
    const items = [box('foo123bar456')];
    const matches = findMatchesOnPage(items, 1, '\\d+', { useRegex: true });
    expect(matches.map((m) => m.text)).toEqual(['123', '456']);
  });

  it('useRegex: trueかつcaseSensitive: falseの場合、大文字小文字を区別しない', () => {
    const items = [box('Hello World')];
    const matches = findMatchesOnPage(items, 1, 'world', { useRegex: true });
    expect(matches).toHaveLength(1);
  });

  it('useRegex: trueかつcaseSensitive: trueの場合、大文字小文字を区別する', () => {
    const items = [box('Hello World')];
    expect(
      findMatchesOnPage(items, 1, 'world', { useRegex: true, caseSensitive: true }),
    ).toHaveLength(0);
  });

  it('不正な正規表現（入力途中の状態を含む）はエラーを投げずマッチ0件になる', () => {
    const items = [box('Hello World')];
    expect(() => findMatchesOnPage(items, 1, '[unterminated', { useRegex: true })).not.toThrow();
    expect(findMatchesOnPage(items, 1, '[unterminated', { useRegex: true })).toHaveLength(0);
  });

  it('ゼロ幅マッチ（例: "a*"がクエリ非該当の位置でもマッチしうる）で無限ループしない', () => {
    const items = [box('bbb')];
    const matches = findMatchesOnPage(items, 1, 'a*', { useRegex: true });
    // 各文字位置＋末尾でゼロ幅マッチしうるが、ここでは長さ0の結果は除外されている
    expect(matches.every((m) => m.text.length > 0)).toBeTrue();
  });
});

describe('annotationTextItemsByPage', () => {
  function textAnnotation(
    text: string,
    pageNumber: number,
    overrides: Partial<{ x: number; y: number; width: number; height: number }> = {},
  ): AnnotationStyle {
    return TextAnnotationStyle.parse({
      ...baseAnnotationFields,
      type: 'text',
      pageNumber,
      x: overrides.x ?? 0,
      y: overrides.y ?? 0,
      width: overrides.width ?? 100,
      height: overrides.height ?? 20,
      text,
    });
  }

  it('textタイプのアノテーションのみをページ番号ごとにグルーピングして返す', () => {
    const annotations: AnnotationStyle[] = [
      textAnnotation('hello', 1),
      textAnnotation('world', 2),
      textAnnotation('again', 1),
    ];
    const byPage = annotationTextItemsByPage(annotations);
    expect(byPage.get(1)?.map((i) => i.text)).toEqual(['hello', 'again']);
    expect(byPage.get(2)?.map((i) => i.text)).toEqual(['world']);
  });

  it('text以外のタイプ・空文字のtextは除外する', () => {
    const boxAnnotation = BoxAnnotationStyle.parse({
      ...baseAnnotationFields,
      type: 'box',
      pageNumber: 1,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    const emptyText = textAnnotation('', 1);
    const annotations: AnnotationStyle[] = [boxAnnotation, emptyText];
    expect(annotationTextItemsByPage(annotations).size).toBe(0);
  });

  it('位置・サイズをTextItemBoxと同じ形（x/y/width/height）で引き継ぐ', () => {
    const annotations = [textAnnotation('hi', 1, { x: 10, y: 20, width: 30, height: 40 })];
    const items = annotationTextItemsByPage(annotations).get(1);
    expect(items).toEqual([{ text: 'hi', x: 10, y: 20, width: 30, height: 40 }]);
  });

  it('アノテーションのテキストもfindMatchesOnPageでPDFテキストと同様に検索できる', () => {
    const pdfItems = [box('apple', { x: 0 })];
    const annotationItems = annotationTextItemsByPage([
      textAnnotation('banana', 1, { x: 200 }),
    ]).get(1)!;
    const matches = findMatchesOnPage([...pdfItems, ...annotationItems], 1, 'banana');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.boxes[0]?.x).toBe(200);
  });
});
