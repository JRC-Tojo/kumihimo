import { describe, expect, it } from 'bun:test';
import type { TextItemBox } from 'src/models/document/pdf';
import { findMatchesOnPage, searchMatchDomId } from '../textSearch';

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

describe('searchMatchDomId', () => {
  it('page/matchIndexの組から一意な文字列を生成する', () => {
    const id = searchMatchDomId({
      pageNumber: 2,
      matchIndex: 5,
      text: 'foo',
      boxes: [{ x: 0, y: 0, width: 0, height: 0 }],
    });
    expect(id).toBe('search-match-p2-m5');
  });
});
