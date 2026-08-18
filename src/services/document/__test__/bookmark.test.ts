import { describe, expect, it, mock } from 'bun:test';
import type { ContainerElementFile, ContainerID } from 'src/models/container';
import type { Result } from 'src/models/error/result';
import { Failure, NotFoundError, Success } from 'src/models/error/result';
import type {
  BookmarkID,
  BookmarkInfo,
  DocumentConfigFile,
} from 'src/models/relational/fileSchema';
import type { AnnotationGroup, AnnotationGroupID } from 'src/models/document/group';

/**
 * `src/services/document/config`（loadConfig）と`src/services/container/config`
 * （saveDocumentConfigFile）をモック化し、bookmark.ts自体のマージ・削除・改名ロジックのみを
 * 検証する。両モジュールの内部実装（ファイルハッシュ計算、アノテーションDB同期等）は
 * 別ファイルの責務であり、ここでは検証しない
 */
const loadConfigMock = mock((): Promise<Result<DocumentConfigFile>> =>
  Promise.resolve(
    Success({ fileHash: 'hash', annots: {}, bookmarks: {}, groups: {}, outlineImported: false }),
  ),
);
const saveDocumentConfigFileMock = mock(
  (
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    _cID: ContainerID,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    _filePath: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    _annotInfos: unknown[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    _fileHash: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    _bookmarks: Record<BookmarkID, BookmarkInfo>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    _groups: Record<AnnotationGroupID, AnnotationGroup>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    _outlineImported: boolean,
  ): Promise<Result<void>> => Promise.resolve(Success()),
);

void mock.module('src/services/document/config', () => ({
  loadConfig: loadConfigMock,
}));
void mock.module('src/services/container/config', () => ({
  saveDocumentConfigFile: saveDocumentConfigFileMock,
}));

const { listBookmarks, addBookmark, removeBookmark, renameBookmark } = await import('../bookmark');

const containerID = '00000000-0000-4000-8000-000000000000' as ContainerID;
const file: ContainerElementFile = {
  containerID,
  type: 'File',
  path: 'doc.pdf',
  createdAt: new Date(),
  updatedAt: new Date(),
  description: '',
  genre: '',
  tags: [],
};

function savedBookmarksArg(): Record<BookmarkID, BookmarkInfo> {
  const call = saveDocumentConfigFileMock.mock.calls.at(-1);
  if (!call) throw new Error('saveDocumentConfigFile was not called');
  return call[4];
}

describe('listBookmarks', () => {
  it('登録済みブックマークをページ番号昇順で返す', async () => {
    loadConfigMock.mockImplementationOnce(() =>
      Promise.resolve(
        Success({
          fileHash: 'hash',
          annots: {},
          bookmarks: {
            b2: { id: 'b2' as BookmarkID, title: 'Two', pageNumber: 5 },
            b1: { id: 'b1' as BookmarkID, title: 'One', pageNumber: 2 },
          },
          groups: {},
          outlineImported: false,
        }),
      ),
    );

    const res = await listBookmarks(file);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.map((b) => b.title)).toEqual(['One', 'Two']);
  });

  it('loadConfigが失敗した場合はそのまま伝播する', async () => {
    loadConfigMock.mockImplementationOnce(() => Promise.resolve(Failure(new Error('boom'))));
    const res = await listBookmarks(file);
    expect(res.ok).toBeFalse();
  });
});

describe('addBookmark', () => {
  it('新規ブックマークを既存のfileHashを維持したまま追加保存する', async () => {
    loadConfigMock.mockImplementationOnce(() =>
      Promise.resolve(
        Success({
          fileHash: 'hash1',
          annots: {},
          bookmarks: {},
          groups: {},
          outlineImported: false,
        }),
      ),
    );

    const res = await addBookmark(file, 'タイトル', 3);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.title).toBe('タイトル');
    expect(res.value.pageNumber).toBe(3);

    const [, , , fileHashArg] = saveDocumentConfigFileMock.mock.calls.at(-1)!;
    expect(fileHashArg).toBe('hash1');
    expect(Object.values(savedBookmarksArg())).toEqual([
      { id: res.value.id, title: 'タイトル', pageNumber: 3 },
    ]);
  });

  it('既存のブックマークを消さずに追加する', async () => {
    const existingId = 'existing' as BookmarkID;
    loadConfigMock.mockImplementationOnce(() =>
      Promise.resolve(
        Success({
          fileHash: 'hash',
          annots: {},
          bookmarks: { [existingId]: { id: existingId, title: '既存', pageNumber: 1 } },
          groups: {},
          outlineImported: false,
        }),
      ),
    );

    const res = await addBookmark(file, '新規', 2);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    const saved = savedBookmarksArg();
    expect(Object.keys(saved).sort()).toEqual([existingId, res.value.id].sort());
    expect(saved[existingId]).toEqual({ id: existingId, title: '既存', pageNumber: 1 });
  });

  it('parentIdを指定すると子要素として登録される', async () => {
    const parentId = 'parent' as BookmarkID;
    loadConfigMock.mockImplementationOnce(() =>
      Promise.resolve(
        Success({
          fileHash: 'hash',
          annots: {},
          bookmarks: { [parentId]: { id: parentId, title: '親', pageNumber: 1 } },
          groups: {},
          outlineImported: false,
        }),
      ),
    );

    const res = await addBookmark(file, '子', 2, { parentId });
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.parentId).toBe(parentId);
    expect(savedBookmarksArg()[res.value.id]?.parentId).toBe(parentId);
  });

  it('annotationIdを指定すると保存されるブックマークに反映される', async () => {
    loadConfigMock.mockImplementationOnce(() =>
      Promise.resolve(
        Success({
          fileHash: 'hash',
          annots: {},
          bookmarks: {},
          groups: {},
          outlineImported: false,
        }),
      ),
    );

    const annotationId = 'annot-1' as never;
    const res = await addBookmark(file, 'アノテーション', 3, { annotationId });
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.annotationId).toBe(annotationId);
  });

  it('保存時に既存のoutlineImportedの値を維持する', async () => {
    loadConfigMock.mockImplementationOnce(() =>
      Promise.resolve(
        Success({ fileHash: 'hash', annots: {}, bookmarks: {}, groups: {}, outlineImported: true }),
      ),
    );

    await addBookmark(file, 'タイトル', 1);
    const [, , , , , , outlineImportedArg] = saveDocumentConfigFileMock.mock.calls.at(-1)!;
    expect(outlineImportedArg).toBe(true);
  });
});

describe('removeBookmark', () => {
  it('指定したIDのブックマークのみを取り除いて保存する', async () => {
    const keepId = 'keep' as BookmarkID;
    const removeId = 'remove' as BookmarkID;
    loadConfigMock.mockImplementationOnce(() =>
      Promise.resolve(
        Success({
          fileHash: 'hash',
          annots: {},
          bookmarks: {
            [keepId]: { id: keepId, title: 'Keep', pageNumber: 1 },
            [removeId]: { id: removeId, title: 'Remove', pageNumber: 2 },
          },
          groups: {},
          outlineImported: false,
        }),
      ),
    );

    const res = await removeBookmark(file, removeId);
    expect(res.ok).toBeTrue();
    expect(Object.keys(savedBookmarksArg())).toEqual([keepId]);
  });

  it('存在しないIDを指定した場合もエラーにせず、現状のまま保存する', async () => {
    loadConfigMock.mockImplementationOnce(() =>
      Promise.resolve(
        Success({
          fileHash: 'hash',
          annots: {},
          bookmarks: {},
          groups: {},
          outlineImported: false,
        }),
      ),
    );

    const res = await removeBookmark(file, 'nope' as BookmarkID);
    expect(res.ok).toBeTrue();
    expect(savedBookmarksArg()).toEqual({});
  });

  it('子・孫要素も一緒に削除する（カスケード削除）', async () => {
    const rootId = 'root' as BookmarkID;
    const childId = 'child' as BookmarkID;
    const grandchildId = 'grandchild' as BookmarkID;
    const unrelatedId = 'unrelated' as BookmarkID;
    loadConfigMock.mockImplementationOnce(() =>
      Promise.resolve(
        Success({
          fileHash: 'hash',
          annots: {},
          bookmarks: {
            [rootId]: { id: rootId, title: 'Root', pageNumber: 1 },
            [childId]: { id: childId, title: 'Child', pageNumber: 2, parentId: rootId },
            [grandchildId]: {
              id: grandchildId,
              title: 'Grandchild',
              pageNumber: 3,
              parentId: childId,
            },
            [unrelatedId]: { id: unrelatedId, title: 'Unrelated', pageNumber: 4 },
          },
          groups: {},
          outlineImported: false,
        }),
      ),
    );

    const res = await removeBookmark(file, rootId);
    expect(res.ok).toBeTrue();
    expect(Object.keys(savedBookmarksArg()).sort()).toEqual([unrelatedId]);
  });
});

describe('renameBookmark', () => {
  it('対象のtitleのみを書き換えて保存する（pageNumberは維持される）', async () => {
    const id = 'target' as BookmarkID;
    loadConfigMock.mockImplementationOnce(() =>
      Promise.resolve(
        Success({
          fileHash: 'hash',
          annots: {},
          bookmarks: { [id]: { id, title: '旧名前', pageNumber: 4 } },
          groups: {},
          outlineImported: false,
        }),
      ),
    );

    const res = await renameBookmark(file, id, '新しい名前');
    expect(res.ok).toBeTrue();
    expect(savedBookmarksArg()[id]).toEqual({ id, title: '新しい名前', pageNumber: 4 });
  });

  it('存在しないIDを指定した場合はNotFoundErrorで失敗する', async () => {
    loadConfigMock.mockImplementationOnce(() =>
      Promise.resolve(
        Success({
          fileHash: 'hash',
          annots: {},
          bookmarks: {},
          groups: {},
          outlineImported: false,
        }),
      ),
    );

    const res = await renameBookmark(file, 'nope' as BookmarkID, 'x');
    expect(res.ok).toBeFalse();
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(NotFoundError);
  });
});
