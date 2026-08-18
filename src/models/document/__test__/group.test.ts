import { describe, expect, it } from 'bun:test';
import { AnnotationGroup, AnnotationGroupID, GroupValueAggregation } from '../group';
import type { AnnotationID } from '../pdf';

const groupId = '00000000-0000-4000-8000-000000000001';
const memberIdA = '00000000-0000-4000-8000-000000000002';
const memberIdB = '00000000-0000-4000-8000-000000000003';

describe('AnnotationGroupID', () => {
  it('UUID v4形式の文字列をパースできる', () => {
    expect(AnnotationGroupID.safeParse(groupId).success).toBeTrue();
  });

  it('UUID形式でない文字列は拒否する', () => {
    expect(AnnotationGroupID.safeParse('not-a-uuid').success).toBeFalse();
  });
});

describe('GroupValueAggregation', () => {
  it("type: 'sum' をパースできる", () => {
    expect(GroupValueAggregation.safeParse({ type: 'sum' }).success).toBeTrue();
  });

  it('未知のtypeは拒否する', () => {
    expect(GroupValueAggregation.safeParse({ type: 'average' }).success).toBeFalse();
  });
});

describe('AnnotationGroup', () => {
  const validGroup = {
    id: groupId,
    memberIds: [memberIdA, memberIdB],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('valueAggregationが未設定でもパースできる（グループ作成直後の初期状態）', () => {
    const result = AnnotationGroup.safeParse(validGroup);
    expect(result.success).toBeTrue();
  });

  it('valueAggregationを設定した状態もパースできる', () => {
    const result = AnnotationGroup.safeParse({
      ...validGroup,
      valueAggregation: { type: 'sum' },
    });
    expect(result.success).toBeTrue();
  });

  it('memberIdsが1件以下（ネスト・単独メンバーによるグループ）は拒否する', () => {
    const result = AnnotationGroup.safeParse({ ...validGroup, memberIds: [memberIdA] });
    expect(result.success).toBeFalse();
  });

  it('memberIdsが0件は拒否する', () => {
    const result = AnnotationGroup.safeParse({ ...validGroup, memberIds: [] });
    expect(result.success).toBeFalse();
  });

  it('パース後のmemberIdsはAnnotationID型として扱える', () => {
    const result = AnnotationGroup.parse(validGroup);
    const ids: AnnotationID[] = result.memberIds;
    expect(ids).toEqual([memberIdA, memberIdB]);
  });
});
