import { describe, expect, it } from 'bun:test';
import { reorderPresetsOfType } from '../useAnnotationPresets';
import type { AnnotationTool } from 'src/models/docPage';

function makeTool(id: string, type: AnnotationTool['style']['type']): AnnotationTool {
  return {
    id,
    name: id,
    style: { type, strokeColor: '#000000', strokeWidth: 1, strokeType: 'solid', strokeOpacity: 1 },
  } as AnnotationTool;
}

describe('reorderPresetsOfType', () => {
  it('対象種別だけを並び替え、他種別の位置は変えない', () => {
    const all = [
      makeTool('box-1', 'box'),
      makeTool('line-1', 'line'),
      makeTool('box-2', 'box'),
      makeTool('line-2', 'line'),
      makeTool('box-3', 'box'),
    ];

    const reordered = reorderPresetsOfType(all, 'box', [
      makeTool('box-3', 'box'),
      makeTool('box-1', 'box'),
      makeTool('box-2', 'box'),
    ]);

    expect(reordered.map((t) => t.id)).toEqual(['box-3', 'line-1', 'box-1', 'line-2', 'box-2']);
  });

  it('対象種別が1件も無い場合はそのまま返す', () => {
    const all = [makeTool('line-1', 'line')];
    const reordered = reorderPresetsOfType(all, 'box', []);
    expect(reordered).toEqual(all);
  });
});
