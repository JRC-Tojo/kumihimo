import { describe, test, expect } from 'bun:test';
import {
  buildBookmarkTree,
  collectDescendantIds,
  outlineEntriesToBookmarks,
} from '../bookmarkTree';
import type { BookmarkID, BookmarkInfo } from 'src/models/relational/fileSchema';
import type { PdfOutlineEntry } from 'src/models/document/pdf';

function bm(id: string, pageNumber: number, parentId?: string): BookmarkInfo {
  return {
    id: id as BookmarkID,
    title: id,
    pageNumber,
    parentId: parentId as BookmarkID | undefined,
  };
}

describe('buildBookmarkTree', () => {
  test('parentIdが無い要素はルートになる', () => {
    const tree = buildBookmarkTree([bm('a', 1), bm('b', 2)]);
    expect(tree.map((n) => n.id as string)).toEqual(['a', 'b']);
    expect(tree[0]!.children).toEqual([]);
  });

  test('parentIdを持つ要素は親のchildrenに入る', () => {
    const tree = buildBookmarkTree([bm('parent', 1), bm('child', 2, 'parent')]);
    expect(tree.length).toBe(1);
    expect(tree[0]!.children.map((n) => n.id as string)).toEqual(['child']);
  });

  test('親が存在しないparentIdはルートとして扱う', () => {
    const tree = buildBookmarkTree([bm('orphan', 1, 'missing')]);
    expect(tree.map((n) => n.id as string)).toEqual(['orphan']);
  });

  test('各階層はpageNumber昇順にソートされる', () => {
    const tree = buildBookmarkTree([
      bm('parent', 1),
      bm('child-b', 5, 'parent'),
      bm('child-a', 2, 'parent'),
      bm('root-b', 4),
      bm('root-a', 3),
    ]);
    expect(tree.map((n) => n.id as string)).toEqual(['parent', 'root-a', 'root-b']);
    expect(tree[0]!.children.map((n) => n.id as string)).toEqual(['child-a', 'child-b']);
  });
});

describe('collectDescendantIds', () => {
  test('子・孫を再帰的に集める', () => {
    const bookmarks = [
      bm('root', 1),
      bm('child', 2, 'root'),
      bm('grandchild', 3, 'child'),
      bm('unrelated', 4),
    ];
    const ids = collectDescendantIds(bookmarks, 'root' as BookmarkID);
    expect(new Set(ids as string[])).toEqual(new Set(['child', 'grandchild']));
  });

  test('子要素が無い場合は空配列を返す', () => {
    const bookmarks = [bm('root', 1)];
    expect(collectDescendantIds(bookmarks, 'root' as BookmarkID)).toEqual([]);
  });

  test('外部編集による循環参照があっても無限ループにならない', () => {
    // 外部で編集された.kcfgがa→b→aのような循環したparentIdを持ち込むケースを想定
    const bookmarks = [bm('a', 1, 'b'), bm('b', 2, 'a')];
    const ids = collectDescendantIds(bookmarks, 'a' as BookmarkID);
    expect(new Set(ids as string[])).toEqual(new Set(['a', 'b']));
  });
});

describe('outlineEntriesToBookmarks', () => {
  function makeIdGen() {
    let n = 0;
    return () => `id-${n++}` as BookmarkID;
  }

  test('levelの入れ子に応じてparentIdを設定する', () => {
    const entries: PdfOutlineEntry[] = [
      { title: '第1章', level: 0, pageNumber: 1 },
      { title: '1.1', level: 1, pageNumber: 2 },
      { title: '1.2', level: 1, pageNumber: 3 },
      { title: '第2章', level: 0, pageNumber: 10 },
    ];
    const bookmarks = outlineEntriesToBookmarks(entries, makeIdGen());

    expect(bookmarks.map((b) => b.title)).toEqual(['第1章', '1.1', '1.2', '第2章']);
    const [ch1, s11, s12, ch2] = bookmarks;
    expect(ch1!.parentId).toBeUndefined();
    expect(s11!.parentId).toBe(ch1!.id);
    expect(s12!.parentId).toBe(ch1!.id);
    expect(ch2!.parentId).toBeUndefined();
  });

  test('深い階層から浅い階層への飛び戻りも正しく親を解決する', () => {
    const entries: PdfOutlineEntry[] = [
      { title: 'a', level: 0, pageNumber: 1 },
      { title: 'a-1', level: 1, pageNumber: 2 },
      { title: 'a-1-1', level: 2, pageNumber: 3 },
      { title: 'a-2', level: 1, pageNumber: 4 },
    ];
    const bookmarks = outlineEntriesToBookmarks(entries, makeIdGen());
    const [a, a1, a11, a2] = bookmarks;
    expect(a11!.parentId).toBe(a1!.id);
    expect(a2!.parentId).toBe(a!.id);
  });

  test('levelが1階層ずつ増えず飛び越える場合も、直近の浅い祖先を親として解決する', () => {
    const entries: PdfOutlineEntry[] = [
      { title: 'a', level: 0, pageNumber: 1 },
      // level 1が存在しないままlevel 2に飛ぶ（PDFのアウトラインでlevelの連続性は保証されない）
      { title: 'a-x-1', level: 2, pageNumber: 2 },
    ];
    const bookmarks = outlineEntriesToBookmarks(entries, makeIdGen());
    const [a, ax1] = bookmarks;
    expect(ax1!.parentId).toBe(a!.id);
  });

  test('pageNumberが解決できないエントリは除外する', () => {
    const entries: PdfOutlineEntry[] = [
      { title: 'no-page', level: 0, pageNumber: undefined },
      { title: 'has-page', level: 0, pageNumber: 1 },
    ];
    const bookmarks = outlineEntriesToBookmarks(entries, makeIdGen());
    expect(bookmarks.map((b) => b.title)).toEqual(['has-page']);
  });
});
