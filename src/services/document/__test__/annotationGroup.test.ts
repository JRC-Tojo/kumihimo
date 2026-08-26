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
import type { AnnotationID } from 'src/models/document/pdf';

/**
 * `src/services/document/config`（loadConfig）・`src/services/container/config`
 * （saveDocumentConfigFile）・`src/repositories/db/annotationGroup`をモック化し、
 * annotationGroup.ts自体のマージ・解散・バリデーションロジックのみを検証する
 * （`bookmark.test.ts`と同じ方針）
 */
const idA = '00000000-0000-4000-8000-000000000001' as AnnotationID;
const idB = '00000000-0000-4000-8000-000000000002' as AnnotationID;
const idC = '00000000-0000-4000-8000-000000000003' as AnnotationID;
const existingGroupId = '00000000-0000-4000-8000-0000000000aa' as AnnotationGroupID;

let documentConfigFileFixture: DocumentConfigFile = {
  fileHash: 'hash',
  annots: {},
  bookmarks: {},
  groups: {},
  outlineImported: false,
};
const loadConfigMock = mock((): Promise<Result<DocumentConfigFile>> =>
  Promise.resolve(Success(documentConfigFileFixture)),
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

const upsertGroupsMock = mock((): Promise<Result<void>> => Promise.resolve(Success()));
const removeGroupMock = mock((): Promise<Result<void>> => Promise.resolve(Success()));
void mock.module('src/repositories/db/annotationGroup', () => ({
  upsertGroups: upsertGroupsMock,
  removeGroup: removeGroupMock,
  getGroup: mock(() => Promise.resolve(Failure(new NotFoundError('not mocked')))),
  remapFilePath: mock(() => Promise.resolve(Success())),
}));

const {
  groupAnnotations,
  ungroupAnnotations,
  updateGroupValueAggregation,
  restoreGroup,
  removeGroupMembers,
} = await import('../annotationGroup');

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

function savedGroupsArg(): Record<AnnotationGroupID, AnnotationGroup> {
  const call = saveDocumentConfigFileMock.mock.calls.at(-1);
  if (!call) throw new Error('saveDocumentConfigFile was not called');
  return call[5];
}

describe('groupAnnotations', () => {
  it('2件以上のアノテーションを新規グループとして作成する', async () => {
    documentConfigFileFixture = {
      fileHash: 'hash',
      annots: {},
      bookmarks: {},
      groups: {},
      outlineImported: false,
    };

    const res = await groupAnnotations(file, [idA, idB]);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    expect(res.value.group.memberIds.sort()).toEqual([idA, idB].sort());
    expect(res.value.group.valueAggregation).toBeUndefined();
    expect(res.value.dissolvedGroups).toEqual([]);

    const saved = savedGroupsArg();
    expect(Object.values(saved).length).toBe(1);
  });

  it('1件のみの選択は失敗する（最低2件必要）', async () => {
    documentConfigFileFixture = {
      fileHash: 'hash',
      annots: {},
      bookmarks: {},
      groups: {},
      outlineImported: false,
    };

    const res = await groupAnnotations(file, [idA]);
    expect(res.ok).toBeFalse();
  });

  it('選択に既存グループのメンバーが含まれる場合、そのグループを解散して統合する', async () => {
    const existingGroup: AnnotationGroup = {
      id: existingGroupId,
      memberIds: [idA, idB],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    documentConfigFileFixture = {
      fileHash: 'hash',
      annots: {},
      bookmarks: {},
      groups: { [existingGroupId]: existingGroup },
      outlineImported: false,
    };

    // idB（既存グループのメンバー）とidC（未グループ）を選択して再グループ化する
    const res = await groupAnnotations(file, [idB, idC]);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    expect(res.value.dissolvedGroups).toEqual([existingGroup]);
    // 新しいグループはidA・idB・idCすべてを含む（idAはidBを介して統合される）
    expect(res.value.group.memberIds.sort()).toEqual([idA, idB, idC].sort());

    const saved = savedGroupsArg();
    // 旧グループは残らず、新しいグループ1件のみになる
    expect(Object.keys(saved)).toEqual([res.value.group.id]);
  });
});

describe('ungroupAnnotations', () => {
  it('既存グループを解除する', async () => {
    const existingGroup: AnnotationGroup = {
      id: existingGroupId,
      memberIds: [idA, idB],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    documentConfigFileFixture = {
      fileHash: 'hash',
      annots: {},
      bookmarks: {},
      groups: { [existingGroupId]: existingGroup },
      outlineImported: false,
    };

    const res = await ungroupAnnotations(file, existingGroupId);
    expect(res.ok).toBeTrue();

    const saved = savedGroupsArg();
    expect(Object.keys(saved)).toEqual([]);
  });

  it('存在しないグループIDを指定した場合はNotFoundErrorで失敗する', async () => {
    documentConfigFileFixture = {
      fileHash: 'hash',
      annots: {},
      bookmarks: {},
      groups: {},
      outlineImported: false,
    };

    const res = await ungroupAnnotations(file, 'nope' as AnnotationGroupID);
    expect(res.ok).toBeFalse();
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(NotFoundError);
  });
});

describe('updateGroupValueAggregation', () => {
  it('グループの値算出方法を更新して保存する', async () => {
    const existingGroup: AnnotationGroup = {
      id: existingGroupId,
      memberIds: [idA, idB],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    documentConfigFileFixture = {
      fileHash: 'hash',
      annots: {},
      bookmarks: {},
      groups: { [existingGroupId]: existingGroup },
      outlineImported: false,
    };

    const res = await updateGroupValueAggregation(file, existingGroupId, { type: 'sum' });
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.valueAggregation).toEqual({ type: 'sum' });

    const saved = savedGroupsArg();
    expect(saved[existingGroupId]?.valueAggregation).toEqual({ type: 'sum' });
  });

  it('undefinedを渡すと値算出方法を未設定に戻す', async () => {
    const existingGroup: AnnotationGroup = {
      id: existingGroupId,
      memberIds: [idA, idB],
      valueAggregation: { type: 'sum' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    documentConfigFileFixture = {
      fileHash: 'hash',
      annots: {},
      bookmarks: {},
      groups: { [existingGroupId]: existingGroup },
      outlineImported: false,
    };

    const res = await updateGroupValueAggregation(file, existingGroupId, undefined);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.valueAggregation).toBeUndefined();
  });
});

describe('restoreGroup', () => {
  it('キャプチャ済みのグループ記録をそのままの内容で書き戻す', async () => {
    documentConfigFileFixture = {
      fileHash: 'hash',
      annots: {},
      bookmarks: {},
      groups: {},
      outlineImported: false,
    };
    const captured: AnnotationGroup = {
      id: existingGroupId,
      memberIds: [idA, idB],
      valueAggregation: { type: 'sum' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const res = await restoreGroup(file, captured);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    // idや timestampを新規発行せず、渡した内容をそのまま返す
    expect(res.value).toEqual(captured);

    const saved = savedGroupsArg();
    expect(saved[existingGroupId]).toEqual(captured);
  });
});

describe('removeGroupMembers', () => {
  it('指定したメンバーだけを取り除き、グループ自体は残す', async () => {
    const existingGroup: AnnotationGroup = {
      id: existingGroupId,
      memberIds: [idA, idB, idC],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    documentConfigFileFixture = {
      fileHash: 'hash',
      annots: {},
      bookmarks: {},
      groups: { [existingGroupId]: existingGroup },
      outlineImported: false,
    };

    const res = await removeGroupMembers(file, existingGroupId, [idC]);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.memberIds.sort()).toEqual([idA, idB].sort());

    const saved = savedGroupsArg();
    expect(saved[existingGroupId]?.memberIds.sort()).toEqual([idA, idB].sort());
  });

  it('数式モードの値算出方法が設定されている場合、メンバー縮小に伴い未設定へ戻す（変数割当のずれを防ぐ）', async () => {
    const existingGroup: AnnotationGroup = {
      id: existingGroupId,
      memberIds: [idA, idB, idC],
      valueAggregation: { type: 'formula', expression: 'A - B + C' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    documentConfigFileFixture = {
      fileHash: 'hash',
      annots: {},
      bookmarks: {},
      groups: { [existingGroupId]: existingGroup },
      outlineImported: false,
    };

    const res = await removeGroupMembers(file, existingGroupId, [idC]);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.valueAggregation).toBeUndefined();
  });

  it('合計モードはメンバー縮小後も維持される（memberIdsの並び順に依存しないため）', async () => {
    const existingGroup: AnnotationGroup = {
      id: existingGroupId,
      memberIds: [idA, idB, idC],
      valueAggregation: { type: 'sum' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    documentConfigFileFixture = {
      fileHash: 'hash',
      annots: {},
      bookmarks: {},
      groups: { [existingGroupId]: existingGroup },
      outlineImported: false,
    };

    const res = await removeGroupMembers(file, existingGroupId, [idC]);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.valueAggregation).toEqual({ type: 'sum' });
  });

  it('残りメンバー数が最低数を下回る場合は失敗する', async () => {
    const existingGroup: AnnotationGroup = {
      id: existingGroupId,
      memberIds: [idA, idB],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    documentConfigFileFixture = {
      fileHash: 'hash',
      annots: {},
      bookmarks: {},
      groups: { [existingGroupId]: existingGroup },
      outlineImported: false,
    };

    const res = await removeGroupMembers(file, existingGroupId, [idB]);
    expect(res.ok).toBeFalse();
  });

  it('存在しないグループIDを指定した場合はNotFoundErrorで失敗する', async () => {
    documentConfigFileFixture = {
      fileHash: 'hash',
      annots: {},
      bookmarks: {},
      groups: {},
      outlineImported: false,
    };

    const res = await removeGroupMembers(file, 'nope' as AnnotationGroupID, [idA]);
    expect(res.ok).toBeFalse();
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(NotFoundError);
  });
});
