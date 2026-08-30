import { describe, expect, it, beforeEach, mock } from 'bun:test';
import { createPinia, setActivePinia } from 'pinia';
import type { AnnotationID } from 'src/models/document/pdf';
import type { AnnotationGroupID } from 'src/models/document/group';
import type { ContainerElementFile, ContainerID } from 'src/models/container';
import type { Relational } from 'src/models/relational/common';
import type { RelationalCheckedRule } from 'src/models/relational/fileSchema';
import type { RelationalEdge } from '../relationalStore';

/**
 * `statusForAnnotationIncludingGroup`（グループを端点とする関係性の検証結果を、
 * メンバー各アノテーションの表示スタイルへ反映するために追加したgetter）の検証。
 * 直接`edgesByFileKey`へフィクスチャを設定し、APIやDB等の外部依存を挟まずに
 * getterの集計ロジックのみを検証する。
 *
 * `relationalStore.ts`は`useBackendApi`（`src/apis/backendApi.ts`）を静的importしており、
 * これは全サービス（pdf.js等を含む）を束ねる巨大なファサードのため、実体のまま読み込むと
 * Bunのテスト環境ではDOMMatrix等のブラウザAPI依存で失敗する。このテストでは大半のケースで
 * `refreshFile`等のAPI呼び出しを一切使わず`edgesByFileKey`を直接操作するだけのため、
 * `getRelationalsForFile`・`checkRelationalsSafe`のみモック化する（`refreshFile`の直列化を
 * 検証する`describe`ブロックでのみ実際に使う）
 */
const apiMock = {
  getRelationalsForFile: mock((): Promise<{ ok: true; data: { relational: Relational }[] }> =>
    Promise.resolve({ ok: true, data: [] }),
  ),
  checkRelationalsSafe: mock(
    (edge: {
      relational: Relational;
    }): Promise<{
      ok: true;
      data: { checkedRule: undefined; srcVal: string; targetVal: string };
    }> =>
      Promise.resolve({
        ok: true,
        data: {
          checkedRule: undefined,
          srcVal: edge.relational.srcID,
          targetVal: edge.relational.targetID,
        },
      }),
  ),
};
void mock.module('src/apis/backendApi', () => ({ useBackendApi: () => apiMock }));

const { useRelationalStore, fileKey } = await import('../relationalStore');
const idA = '00000000-0000-4000-8000-000000000001' as AnnotationID;
const idC = '00000000-0000-4000-8000-000000000003' as AnnotationID;
const groupId = '00000000-0000-4000-8000-0000000000aa' as AnnotationGroupID;

function buildEdge(srcID: string, targetID: string, isOK: boolean | undefined): RelationalEdge {
  const checkedRule: RelationalCheckedRule | undefined =
    isOK === undefined ? undefined : { rule: { type: 'link' }, isOK };
  return {
    relational: { srcID, targetID, rule: { type: 'link' } } as RelationalEdge['relational'],
    checkedRule,
    srcVal: 'a',
    targetVal: 'b',
  };
}

describe('relationalStore.statusForAnnotationIncludingGroup', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('グループを端点とする関係性の検証結果を、メンバーのアノテーションID単体では拾えない（statusForAnnotationとの対比）', () => {
    const store = useRelationalStore();
    store.edgesByFileKey = { 'c|doc.pdf': [buildEdge(groupId, idC, true)] };

    // 既存のstatusForAnnotationは、メンバー自身のIDに紐づくエッジしか見ないため undefined のまま
    expect(store.statusForAnnotation(idA)).toBeUndefined();
  });

  it('statusForAnnotationIncludingGroupは、所属グループを端点とする関係性の検証結果を反映する（OK）', () => {
    const store = useRelationalStore();
    store.edgesByFileKey = { 'c|doc.pdf': [buildEdge(groupId, idC, true)] };

    expect(store.statusForAnnotationIncludingGroup(idA, groupId)).toBe('ok');
  });

  it('statusForAnnotationIncludingGroupは、グループの関係性がNGならNGを返す', () => {
    const store = useRelationalStore();
    store.edgesByFileKey = { 'c|doc.pdf': [buildEdge(groupId, idC, false)] };

    expect(store.statusForAnnotationIncludingGroup(idA, groupId)).toBe('ng');
  });

  it('statusForAnnotationIncludingGroupは、検証未完了（isOK未確定）ならpendingを返す', () => {
    const store = useRelationalStore();
    store.edgesByFileKey = { 'c|doc.pdf': [buildEdge(groupId, idC, undefined)] };

    expect(store.statusForAnnotationIncludingGroup(idA, groupId)).toBe('pending');
  });

  it('groupIdが未指定（グループ未所属）の場合は、自分自身のエッジのみで判定する', () => {
    const store = useRelationalStore();
    store.edgesByFileKey = {
      'c|doc.pdf': [buildEdge(idA, idC, true), buildEdge(groupId, idC, false)],
    };

    // groupIdを渡さなければ、グループ側のNGは無視され自分自身のOKのみで判定される
    expect(store.statusForAnnotationIncludingGroup(idA, undefined)).toBe('ok');
  });

  it('自分自身を直接端点とする関係性と、所属グループを端点とする関係性の両方がある場合、ng優先で集計する', () => {
    const store = useRelationalStore();
    store.edgesByFileKey = {
      'c|doc.pdf': [buildEdge(idA, idC, true), buildEdge(groupId, idC, false)],
    };

    expect(store.statusForAnnotationIncludingGroup(idA, groupId)).toBe('ng');
  });

  it('いずれの関連も無ければundefinedを返す', () => {
    const store = useRelationalStore();
    store.edgesByFileKey = {};

    expect(store.statusForAnnotationIncludingGroup(idA, groupId)).toBeUndefined();
  });
});

describe('relationalStore.refreshFile（同一ファイルへの並行呼び出しの直列化）', () => {
  const file: ContainerElementFile = {
    containerID: '00000000-0000-4000-8000-000000000000' as ContainerID,
    type: 'File' as const,
    path: 'doc.pdf',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    description: '',
    genre: '',
    tags: [],
  };
  const staleRelational: Relational = { srcID: idA, targetID: idC, rule: { type: 'link' } };
  const freshRelational: Relational = { srcID: idA, targetID: idC, rule: { type: 'equal' } };

  beforeEach(() => {
    setActivePinia(createPinia());
    apiMock.getRelationalsForFile.mockClear();
    apiMock.checkRelationalsSafe.mockClear();
  });

  it('先に呼ばれた（完了が遅い）refreshFileが、後に呼ばれた（完了が早いはずの）refreshFileの結果を後追いで上書きしない', async () => {
    const store = useRelationalStore();

    // 呼び出し#1（削除前に古い状態を読みに行った側を模す）は、任意のタイミングまで完了を止める
    let releaseFirstCall: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFirstCall = resolve;
    });
    apiMock.getRelationalsForFile
      .mockImplementationOnce(async () => {
        await gate;
        return { ok: true, data: [{ relational: staleRelational }] };
      })
      // 呼び出し#2（関係性登録直後の最新状態を読みに行った側を模す）は即座に解決する
      .mockImplementationOnce(() =>
        Promise.resolve({ ok: true, data: [{ relational: freshRelational }] }),
      );

    const first = store.refreshFile(file);
    const second = store.refreshFile(file);

    // 呼び出し#1をまだ完了させていない時点では、直列化されていれば呼び出し#2はまだ
    // getRelationalsForFileにすら到達していないはず（直列化されていなければ、#2が先に解決して
    // キャッシュへ書き込んでしまう）
    await Promise.resolve();
    expect(apiMock.getRelationalsForFile).toHaveBeenCalledTimes(1);

    releaseFirstCall();
    await Promise.all([first, second]);

    // 直列化により、後に呼ばれた#2の結果が最終的にキャッシュへ残る
    // （直列化していない実装では、後から解決した#1の古い状態で上書きされ、ここがstaleRelationalになる）
    const cached = store.edgesByFileKey[fileKey(file)];
    expect(cached).toHaveLength(1);
    expect(cached?.[0]?.relational).toEqual(freshRelational);
  });
});
