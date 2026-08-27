import { describe, expect, it, beforeEach, mock } from 'bun:test';
import { createPinia, setActivePinia } from 'pinia';
import type { AnnotationID } from 'src/models/document/pdf';
import type { AnnotationGroupID } from 'src/models/document/group';
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
 * Bunのテスト環境ではDOMMatrix等のブラウザAPI依存で失敗する。このテストでは
 * `refreshFile`等のAPI呼び出しを一切使わず`edgesByFileKey`を直接操作するだけのため、空でモック化する
 */
void mock.module('src/apis/backendApi', () => ({ useBackendApi: () => ({}) }));

const { useRelationalStore } = await import('../relationalStore');
const idA = '00000000-0000-4000-8000-000000000001' as AnnotationID;
const idC = '00000000-0000-4000-8000-000000000003' as AnnotationID;
const groupId = '00000000-0000-4000-8000-0000000000aa' as AnnotationGroupID;

function buildEdge(
  srcID: string,
  targetID: string,
  isOK: boolean | undefined,
): RelationalEdge {
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
