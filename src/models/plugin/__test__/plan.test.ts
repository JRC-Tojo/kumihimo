import { describe, expect, it } from 'bun:test';
import { PluginPlanItem } from '../plan';

const containerID = '11111111-1111-4111-8111-111111111111';
const annotId = '22222222-2222-4222-8222-222222222222';
const targetId = '33333333-3333-4333-8333-333333333333';

const textStyle = {
  id: annotId,
  type: 'text',
  pageNumber: 1,
  x: 0,
  y: 0,
  color: '#000000',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  width: 80,
  height: 18,
  textColor: '#000000',
};

describe('PluginPlanItem', () => {
  it('annotationCreateをパースできる', () => {
    const result = PluginPlanItem.safeParse({
      id: 'plan-1',
      kind: 'annotationCreate',
      confirmationMode: 'once',
      status: 'planned',
      file: { containerID, path: 'a.pdf' },
      style: textStyle,
    });
    expect(result.success).toBeTrue();
  });

  it('annotationUpdateはannotIdを要求する', () => {
    const result = PluginPlanItem.safeParse({
      id: 'plan-2',
      kind: 'annotationUpdate',
      confirmationMode: 'perItem',
      status: 'planned',
      file: { containerID, path: 'a.pdf' },
      annotId,
      style: textStyle,
    });
    expect(result.success).toBeTrue();
  });

  it('annotationRemoveはstyleを持たない', () => {
    const result = PluginPlanItem.safeParse({
      id: 'plan-3',
      kind: 'annotationRemove',
      confirmationMode: 'once',
      status: 'planned',
      file: { containerID, path: 'a.pdf' },
      annotId,
    });
    expect(result.success).toBeTrue();
  });

  it('relationalCreateはrelationalオブジェクトを要求する', () => {
    const result = PluginPlanItem.safeParse({
      id: 'plan-4',
      kind: 'relationalCreate',
      confirmationMode: 'once',
      status: 'planned',
      relational: { srcID: annotId, targetID: targetId, rule: { type: 'link' } },
    });
    expect(result.success).toBeTrue();
  });

  it('relationalRemoveはsrcId/targetIdを要求する', () => {
    const result = PluginPlanItem.safeParse({
      id: 'plan-5',
      kind: 'relationalRemove',
      confirmationMode: 'once',
      status: 'planned',
      srcId: annotId,
      targetId,
    });
    expect(result.success).toBeTrue();
  });

  it('未知のkindは検証エラーになる', () => {
    const result = PluginPlanItem.safeParse({
      id: 'plan-6',
      kind: 'somethingElse',
      confirmationMode: 'once',
      status: 'planned',
    });
    expect(result.success).toBeFalse();
  });
});
