import { describe, expect, it } from 'bun:test';
import type { TextItemBox } from 'src/models/document/pdf';
import { findMatchesInItem, findMatchesOnPage, searchMatchDomId } from '../textSearch';

function box(text: string, overrides: Partial<TextItemBox> = {}): TextItemBox {
  return { text, x: 0, y: 0, width: text.length * 10, height: 10, ...overrides };
}

describe('findMatchesInItem', () => {
  it('クエリが1回だけ出現する場合、文字位置に比例したサブ矩形を1件返す', () => {
    const item = box('Hello World'); // charWidth = 110/11 = 10
    const matches = findMatchesInItem(item, 'World');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({ x: 60, y: 0, width: 50, height: 10 });
  });

  it('大文字小文字を区別しない（既定）', () => {
    const item = box('Hello World');
    expect(findMatchesInItem(item, 'world')).toHaveLength(1);
  });

  it('caseSensitive: trueの場合は大文字小文字が一致しないとマッチしない', () => {
    const item = box('Hello World');
    expect(findMatchesInItem(item, 'world', { caseSensitive: true })).toHaveLength(0);
    expect(findMatchesInItem(item, 'World', { caseSensitive: true })).toHaveLength(1);
  });

  it('同一アイテム内に複数回出現する場合、重複しない出現箇所をすべて返す', () => {
    const item = box('ababab'); // charWidth = 60/6 = 10
    const matches = findMatchesInItem(item, 'ab');
    expect(matches).toHaveLength(3);
    expect(matches.map((m) => m.x)).toEqual([0, 20, 40]);
  });

  it('マッチが重複しないよう、消費済みの範囲から次を探す（"aaa"にクエリ"aa"は1回のみ）', () => {
    const item = box('aaa');
    const matches = findMatchesInItem(item, 'aa');
    expect(matches).toHaveLength(1);
  });

  it('クエリが空文字の場合はマッチしない', () => {
    const item = box('Hello World');
    expect(findMatchesInItem(item, '')).toHaveLength(0);
  });

  it('アイテムのテキストが空文字の場合はマッチしない', () => {
    const item = box('', { width: 0 });
    expect(findMatchesInItem(item, 'a')).toHaveLength(0);
  });

  it('マッチしないクエリでは空配列を返す', () => {
    const item = box('Hello World');
    expect(findMatchesInItem(item, 'xyz')).toHaveLength(0);
  });

  it('アイテム自身のx/y原点を基準に矩形を算出する', () => {
    const item = box('Hello World', { x: 100, y: 50 });
    const matches = findMatchesInItem(item, 'Hello');
    expect(matches[0]).toEqual({ x: 100, y: 50, width: 50, height: 10 });
  });
});

describe('findMatchesOnPage', () => {
  it('複数アイテムにまたがるマッチをすべてpageNumber付きで返す', () => {
    const items = [box('apple'), box('banana apple')];
    const matches = findMatchesOnPage(items, 3, 'apple');
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ pageNumber: 3, itemIndex: 0, matchIndexInItem: 0 });
    expect(matches[1]).toMatchObject({ pageNumber: 3, itemIndex: 1, matchIndexInItem: 0 });
  });

  it('同一アイテム内の複数マッチにはmatchIndexInItemを連番で振る', () => {
    const items = [box('ababab')];
    const matches = findMatchesOnPage(items, 1, 'ab');
    expect(matches.map((m) => m.matchIndexInItem)).toEqual([0, 1, 2]);
  });

  it('マッチが1件もない場合は空配列を返す', () => {
    const items = [box('apple'), box('banana')];
    expect(findMatchesOnPage(items, 1, 'xyz')).toEqual([]);
  });
});

describe('searchMatchDomId', () => {
  it('page/item/matchIndexInItemの組から一意な文字列を生成する', () => {
    const id = searchMatchDomId({
      pageNumber: 2,
      itemIndex: 5,
      matchIndexInItem: 1,
      text: 'foo',
      box: { x: 0, y: 0, width: 0, height: 0 },
    });
    expect(id).toBe('search-match-p2-i5-m1');
  });
});
