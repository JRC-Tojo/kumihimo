/**
 * ブックマークの親子関係（階層構造）に関する純粋な計算処理をまとめたユーティリティ
 *
 * `BookmarkInfo.parentId`は親のIDを指すだけのフラットな構造で保存されているため、
 * 表示・カスケード削除・PDFしおり取り込みのいずれも、ここで木構造やID集合へ変換してから扱う
 */

import type { BookmarkID, BookmarkInfo } from 'src/models/relational/fileSchema';
import type { PdfOutlineEntry } from 'src/models/document/pdf';

/** 子要素を持つブックマーク（表示用の木構造） */
export interface BookmarkNode extends BookmarkInfo {
  children: BookmarkNode[];
}

/**
 * フラットなブックマーク一覧を、親子関係に基づく木構造へ変換する
 *
 * `parentId`が指す先が存在しない（親が削除済み等）場合はルート要素として扱う。
 * 各階層は`pageNumber`昇順で安定ソートする
 */
export function buildBookmarkTree(bookmarks: BookmarkInfo[]): BookmarkNode[] {
  const nodeById = new Map<BookmarkID, BookmarkNode>(
    bookmarks.map((b) => [b.id, { ...b, children: [] }]),
  );

  const roots: BookmarkNode[] = [];
  for (const node of nodeById.values()) {
    const parent = node.parentId !== undefined ? nodeById.get(node.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortRecursive = (nodes: BookmarkNode[]) => {
    nodes.sort((a, b) => a.pageNumber - b.pageNumber);
    nodes.forEach((n) => sortRecursive(n.children));
  };
  sortRecursive(roots);

  return roots;
}

/**
 * 指定したブックマークの子孫（子・孫...）のID一覧を返す（対象自身は含まない）
 *
 * カスケード削除、および削除確認ダイアログで「子要素も削除される」ことを判定する際に使う
 */
export function collectDescendantIds(bookmarks: BookmarkInfo[], rootId: BookmarkID): BookmarkID[] {
  const childrenByParent = new Map<BookmarkID, BookmarkID[]>();
  for (const b of bookmarks) {
    if (b.parentId === undefined) continue;
    const list = childrenByParent.get(b.parentId) ?? [];
    list.push(b.id);
    childrenByParent.set(b.parentId, list);
  }

  // 外部で編集された`.kcfg`が`parentId`の循環参照を持ち込む可能性があるため、訪問済み集合で
  // 同じIDを二度たどらないようにする（ガードが無いと循環時にwhileが終了しない）
  const visited = new Set<BookmarkID>();
  const result: BookmarkID[] = [];
  const stack = [...(childrenByParent.get(rootId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    result.push(id);
    stack.push(...(childrenByParent.get(id) ?? []));
  }
  return result;
}

/**
 * PDFのしおり（アウトライン）一覧を、親子関係を持つ`BookmarkInfo[]`へ変換する
 *
 * `level`（階層の深さ）をスタックで追跡し、各エントリより浅いlevelのうち直近に見たものを
 * 親として`parentId`を決定する。PDFのアウトラインはlevelが1階層ずつ深くなる保証がなく
 * （例: 0の次に2が来る等）、直前の`level - 1`だけを見ると親が見つからずルート扱いになって
 * 階層が潰れてしまうため、浅い方へ順にたどって最も近い祖先を探す。
 * ページ番号が解決できなかったエントリは取り込み対象から除外する。
 * ID生成は呼び出し側（`crypto.randomUUID`をラップしたもの）に委ねることで、この関数自体を
 * 決定的な純粋関数のままテストできるようにする
 */
export function outlineEntriesToBookmarks(
  entries: PdfOutlineEntry[],
  newId: () => BookmarkID,
): BookmarkInfo[] {
  // 各階層で直近に生成したブックマークのIDを保持するスタック（index = level）
  const lastIdAtLevel: (BookmarkID | undefined)[] = [];
  const result: BookmarkInfo[] = [];

  for (const entry of entries) {
    if (entry.pageNumber === undefined) continue;

    let parentId: BookmarkID | undefined;
    for (let level = entry.level - 1; level >= 0; level--) {
      if (lastIdAtLevel[level] !== undefined) {
        parentId = lastIdAtLevel[level];
        break;
      }
    }

    const id = newId();
    result.push({ id, title: entry.title, pageNumber: entry.pageNumber, parentId });
    lastIdAtLevel.length = entry.level + 1;
    lastIdAtLevel[entry.level] = id;
  }

  return result;
}
