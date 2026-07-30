import { describe, expect, it } from 'bun:test';
import { resolveContextMenuAnnotationId } from '../annotationContextMenuHitTest';

describe('resolveContextMenuAnnotationId', () => {
  it('通常のシェイプはattrs.idをそのまま返す', () => {
    expect(resolveContextMenuAnnotationId({ id: 'annot-1' })).toBe('annot-1');
  });

  it('アンカー（annotation-anchor）の場合は親注釈のannotationIdを返す', () => {
    expect(
      resolveContextMenuAnnotationId({
        name: 'annotation-anchor',
        id: 'anchor-1',
        annotationId: 'annot-1',
      }),
    ).toBe('annot-1');
  });

  it('attrsがundefinedの場合はundefinedを返す', () => {
    expect(resolveContextMenuAnnotationId(undefined)).toBeUndefined();
  });

  it('idが無い場合はundefinedを返す', () => {
    expect(resolveContextMenuAnnotationId({})).toBeUndefined();
  });
});
