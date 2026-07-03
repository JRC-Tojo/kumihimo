import { describe, it, expect } from 'bun:test';
import { buildCachedRelationalFile } from '../config';
import type { CachedRelationalFile } from '../../../models/relational/fileSchema';
import type { Relational } from '../../../models/relational/common';
import type { ContainerID } from '../../../models/container';
import type { AnnotationID } from '../../../models/document/pdf';

describe('buildCachedRelationalFile', () => {
  const cID = '00000000-0000-0000-0000-000000000000' as ContainerID;
  const a = '00000000-0000-0000-0000-000000000001' as AnnotationID;
  const b = '00000000-0000-0000-0000-000000000002' as AnnotationID;
  const c = '00000000-0000-0000-0000-000000000003' as AnnotationID;

  it('removes relationals referencing the updated document and preserves unrelated ones', () => {
    const oldFile: CachedRelationalFile = {
      annotIdToFileInfo: {
        [a]: { cID, filePath: 'file1.pdf' },
        [b]: { cID, filePath: 'file2.pdf' },
        [c]: { cID, filePath: 'file3.pdf' },
      },
      relationals: [
        { src: a, target: b, rule: { type: 'link' } },
        { src: c, target: a, rule: { type: 'equal' } },
      ],
    };

    const rs: Relational[] = [
      {
        srcFile: { cID, filePath: 'file3.pdf' },
        srcID: c,
        targetFile: { cID, filePath: 'file1.pdf' },
        targetID: a,
        rule: { type: 'link' },
      },
    ];

    const saved = buildCachedRelationalFile(oldFile, 'file3.pdf', rs);

    expect(saved.relationals).toEqual([
      { src: a, target: b, rule: { type: 'link' } },
      { src: c, target: a, rule: { type: 'link' } },
    ]);
    expect(saved.annotIdToFileInfo).toEqual({
      [a]: { cID, filePath: 'file1.pdf' },
      [b]: { cID, filePath: 'file2.pdf' },
      [c]: { cID, filePath: 'file3.pdf' },
    });
  });

  it('deduplicates duplicate relation entries when building the cached file', () => {
    const oldFile: CachedRelationalFile = {
      annotIdToFileInfo: {
        [a]: { cID, filePath: 'file1.pdf' },
        [b]: { cID, filePath: 'file2.pdf' },
      },
      relationals: [{ src: a, target: b, rule: { type: 'link' } }],
    };

    const rs: Relational[] = [
      {
        srcFile: { cID, filePath: 'file1.pdf' },
        srcID: a,
        targetFile: { cID, filePath: 'file2.pdf' },
        targetID: b,
        rule: { type: 'link' },
      },
      {
        srcFile: { cID, filePath: 'file1.pdf' },
        srcID: a,
        targetFile: { cID, filePath: 'file2.pdf' },
        targetID: b,
        rule: { type: 'link' },
      },
    ];

    const saved = buildCachedRelationalFile(oldFile, 'unchanged.pdf', rs);

    expect(saved.relationals).toEqual([{ src: a, target: b, rule: { type: 'link' } }]);
    expect(saved.annotIdToFileInfo).toEqual({
      [a]: { cID, filePath: 'file1.pdf' },
      [b]: { cID, filePath: 'file2.pdf' },
    });
  });
});
