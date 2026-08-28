import { describe, expect, it, beforeEach, mock } from 'bun:test';
import { createPinia, setActivePinia } from 'pinia';
import type { AnnotationID } from 'src/models/document/pdf';
import type { AnnotationGroupID } from 'src/models/document/group';
import type { AnnotationStyle } from 'src/models/document/pdf';
import type { ContainerElementFile, ContainerID } from 'src/models/container';
import type { Relational } from 'src/models/relational/common';
import type { RelationalEdge } from 'src/stores/relationalStore';

/**
 * `useAnnotationHistory.ts`は`useBackendApi`（PDF描画等ブラウザAPI依存を含む巨大なファサード）を
 * 静的importしているため、Bunのテスト環境で実体のまま読み込むと失敗する。ここでは実際に呼ばれる
 * メソッドだけをモック化し、呼び出し引数（＝undo/redoの手順が正しいか）を検証する。
 * relationalStore・groupStore・historyStoreは実体のPiniaストアを使い、状態を直接シードすることで
 * 「タブを開いてキャッシュ済み」の状態を再現する
 */
/**
 * `ApiResponse<T>`（`src/models/error/api.ts`）の実フィールド（timestamp・requestId等）は
 * `useAnnotationHistory.ts`側では一切参照されないため、モックでは`ok`/`data`/`error`のみを持つ
 * 最小限の形にする。各`mock()`にこの型を明示することで、`mockImplementationOnce`で
 * 失敗ケース（`{ ok: false, ... }`）を差し込んでも型エラーにならないようにする
 */
type MockApiResult<T = undefined> = { ok: true; data: T } | { ok: false; error: unknown };

function ok<T>(data: T): Promise<MockApiResult<T>> {
  return Promise.resolve({ ok: true, data });
}

const apiMock = {
  registerAnnotationStyle: mock((): Promise<MockApiResult> => ok(undefined)),
  removeAnnotation: mock((): Promise<MockApiResult> => ok(undefined)),
  removeGroupMembers: mock((): Promise<MockApiResult> => ok(undefined)),
  ungroupAnnotations: mock((): Promise<MockApiResult> => ok(undefined)),
  restoreGroup: mock((): Promise<MockApiResult> => ok(undefined)),
  registRelationals: mock((): Promise<MockApiResult> => ok(undefined)),
  removeRelationalEdge: mock((): Promise<MockApiResult> => ok(undefined)),
  updateGroupValueAggregation: mock((): Promise<MockApiResult> => ok(undefined)),
  resolveAnnotationFile: mock((): Promise<MockApiResult<ContainerElementFile>> => ok(file)),
  getRelationalsForFile: mock((): Promise<MockApiResult<never[]>> => ok([])),
  listAnnotationGroups: mock((): Promise<MockApiResult<never[]>> => ok([])),
};
void mock.module('src/apis/backendApi', () => ({ useBackendApi: () => apiMock }));

const { useAnnotationHistory } = await import('../useAnnotationHistory');
const { useHistoryStore } = await import('src/stores/historyStore');
const { useRelationalStore } = await import('src/stores/relationalStore');
const { useGroupStore } = await import('src/stores/groupStore');

const containerID = '00000000-0000-4000-8000-000000000000' as ContainerID;
const file: ContainerElementFile = {
  containerID,
  type: 'File' as const,
  path: 'doc.pdf',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  description: '',
  genre: '',
  tags: [],
};
const key = `${containerID}|doc.pdf`;

const idA = '00000000-0000-4000-8000-000000000001' as AnnotationID;
const idB = '00000000-0000-4000-8000-000000000002' as AnnotationID;
const idC = '00000000-0000-4000-8000-000000000003' as AnnotationID;
const groupId = '00000000-0000-4000-8000-0000000000aa' as AnnotationGroupID;

function buildStyle(id: AnnotationID): AnnotationStyle {
  return {
    id,
    type: 'box',
    pageNumber: 1,
    x: 0,
    y: 0,
    color: '#000000' as never,
    strokeWidth: 2,
    strokeType: 'solid',
    width: 10,
    height: 10,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    comment: {},
  };
}

function buildEdge(relational: Relational): RelationalEdge {
  return { relational, checkedRule: undefined, srcVal: '', targetVal: '' };
}

beforeEach(() => {
  setActivePinia(createPinia());
  for (const fn of Object.values(apiMock)) fn.mockClear();
});

describe('recordRelationalCreated', () => {
  it('undoで関係性を削除し、redoで再登録する', async () => {
    const history = useAnnotationHistory();
    const historyStore = useHistoryStore();
    const relational: Relational = { srcID: idA, targetID: idB, rule: { type: 'link' } };

    history.recordRelationalCreated(file, relational, idA);

    await historyStore.undo(file);
    expect(apiMock.removeRelationalEdge).toHaveBeenCalledWith(idA, idB);

    await historyStore.redo(file);
    expect(apiMock.registRelationals).toHaveBeenCalledWith(relational);
  });
});

describe('recordRelationalRemoved', () => {
  it('undoで関係性を再登録し、redoで削除する', async () => {
    const history = useAnnotationHistory();
    const historyStore = useHistoryStore();
    const relational: Relational = { srcID: idA, targetID: idB, rule: { type: 'equal' } };

    history.recordRelationalRemoved(file, relational, idA);

    await historyStore.undo(file);
    expect(apiMock.registRelationals).toHaveBeenCalledWith(relational);

    await historyStore.redo(file);
    expect(apiMock.removeRelationalEdge).toHaveBeenCalledWith(idA, idB);
  });
});

describe('recordRelationalRuleChanged', () => {
  it('undoで新ルールを削除して旧ルールへ戻し、redoで再度新ルールへ変更する', async () => {
    const history = useAnnotationHistory();
    const historyStore = useHistoryStore();
    const previous: Relational = { srcID: idA, targetID: idB, rule: { type: 'link' } };
    const next: Relational = { srcID: idA, targetID: idB, rule: { type: 'equal' } };

    history.recordRelationalRuleChanged(file, previous, next, idA);

    await historyStore.undo(file);
    expect(apiMock.removeRelationalEdge).toHaveBeenLastCalledWith(idA, idB);
    expect(apiMock.registRelationals).toHaveBeenLastCalledWith(previous);

    await historyStore.redo(file);
    expect(apiMock.removeRelationalEdge).toHaveBeenLastCalledWith(idA, idB);
    expect(apiMock.registRelationals).toHaveBeenLastCalledWith(next);
  });
});

describe('removeWithHistory（グループ巻き添え解散時の関係性保全）', () => {
  it('メンバー削除でグループが解散される場合、undoでグループの関係性も復元される（回帰確認）', async () => {
    const history = useAnnotationHistory();
    const historyStore = useHistoryStore();
    const relationalStore = useRelationalStore();
    const groupStore = useGroupStore();

    const now = '2026-01-01T00:00:00.000Z';
    const group = { id: groupId, memberIds: [idA, idB], createdAt: now, updatedAt: now };
    groupStore.groupsByFileKey[key] = [group];

    // グループ自身を端点とする関係性（idCとの間）。解散時に巻き添えで消える対象
    const groupRelational: Relational = { srcID: groupId, targetID: idC, rule: { type: 'link' } };
    relationalStore.edgesByFileKey[key] = [buildEdge(groupRelational)];

    // メンバーが2件ちょうど（MIN_GROUP_MEMBERS）のため、1件削除するとremoveGroupMembersが
    // 失敗を返し、呼び出し元はungroupAnnotations（完全解散）へフォールバックする
    apiMock.removeGroupMembers.mockImplementationOnce(() =>
      Promise.resolve({ ok: false, error: new Error('below min members') }),
    );

    const res = await history.removeWithHistory(file, buildStyle(idA));
    expect(res.ok).toBe(true);
    expect(apiMock.ungroupAnnotations).toHaveBeenCalledWith(file, groupId);

    await historyStore.undo(file);

    // 削除したアノテーション本体の復元
    expect(apiMock.registerAnnotationStyle).toHaveBeenCalledWith(file, buildStyle(idA));
    // 解散したグループの復元
    expect(apiMock.restoreGroup).toHaveBeenCalledWith(file, group);
    // 解散前に捕捉しておいたグループの関係性が再登録されること（これが無いと関係性が失われたままになる）
    expect(apiMock.registRelationals).toHaveBeenCalledWith(groupRelational);
  });
});

describe('recordGroupCreated', () => {
  it('redoで再度グループを解散した後も、影響ファイルのキャッシュ再検証（resolveAnnotationFile）が行われる', async () => {
    const history = useAnnotationHistory();
    const historyStore = useHistoryStore();
    const relationalStore = useRelationalStore();

    const now = '2026-01-01T00:00:00.000Z';
    const dissolvedGroup = { id: groupId, memberIds: [idA, idB], createdAt: now, updatedAt: now };
    const newGroup = { id: groupId, memberIds: [idA, idB, idC], createdAt: now, updatedAt: now };
    const groupRelational: Relational = { srcID: groupId, targetID: idC, rule: { type: 'link' } };

    // redo時にapplyされる再キャプチャが読みに行くキャッシュ（undo後もこの状態のまま）
    relationalStore.edgesByFileKey[key] = [buildEdge(groupRelational)];

    const dissolvedSnapshot = history.captureRelationalSnapshot([groupId]);
    history.recordGroupCreated(file, newGroup, [dissolvedGroup], dissolvedSnapshot);

    await historyStore.undo(file);
    await historyStore.redo(file);

    // redo内でrefreshRelationalSnapshotCachesがgroupRelationalの相手側(idC)のファイルを
    // 解決しようとする（＝以前のバグでは呼ばれていなかった処理）
    expect(apiMock.resolveAnnotationFile).toHaveBeenCalledWith(idC);
  });
});
