import { describe, test, expect } from 'bun:test';
import { buildCachedRelationalFile } from '../config';
import type { CachedRelationalFile } from 'src/models/relational/fileSchema';
import type { RelationalWithAddress } from 'src/models/relational/common';
import type { ContainerID } from 'src/models/container';
import type { AnnotationID } from 'src/models/document/pdf';

describe('buildCachedRelationalFile', () => {
  const cID = '00000000-0000-0000-0000-000000000000' as ContainerID;
  const a = '00000000-0000-0000-0000-000000000001' as AnnotationID;
  const b = '00000000-0000-0000-0000-000000000002' as AnnotationID;
  const c = '00000000-0000-0000-0000-000000000003' as AnnotationID;
  const aAdrs = { cID, filePath: 'file1.pdf' };
  const bAdrs = { cID, filePath: 'file2.pdf' };
  const cAdrs = { cID, filePath: 'file3.pdf' };

  test('removes relationals referencing the updated document and preserves unrelated ones', () => {
    const oldFile: CachedRelationalFile = {
      annotIdToFileInfo: {
        [a]: aAdrs,
        [b]: bAdrs,
        [c]: cAdrs,
      },
      relationals: [
        { src: a, target: b, rule: { type: 'link' } },
        { src: c, target: a, rule: { type: 'equal' } },
      ],
    };

    const rs: RelationalWithAddress[] = [
      {
        relational: {
          srcID: c,
          targetID: a,
          rule: { type: 'link' },
        },
        srcAddress: cAdrs,
        targetAddress: aAdrs,
      },
    ];

    const saved = buildCachedRelationalFile(oldFile, 'file3.pdf', rs);

    expect(saved.relationals).toEqual([
      { src: a, target: b, rule: { type: 'link' } },
      { src: c, target: a, rule: { type: 'link' } },
    ]);
    expect(saved.annotIdToFileInfo).toEqual({
      [a]: aAdrs,
      [b]: bAdrs,
      [c]: cAdrs,
    });
  });

  test('deduplicates duplicate relation entries when building the cached file', () => {
    const oldFile: CachedRelationalFile = {
      annotIdToFileInfo: {
        [a]: aAdrs,
        [b]: bAdrs,
      },
      relationals: [{ src: a, target: b, rule: { type: 'link' } }],
    };

    const rs: RelationalWithAddress[] = [
      {
        relational: {
          srcID: a,
          targetID: b,
          rule: { type: 'link' },
        },
        srcAddress: aAdrs,
        targetAddress: bAdrs,
      },
      {
        relational: {
          srcID: a,
          targetID: b,
          rule: { type: 'link' },
        },
        srcAddress: aAdrs,
        targetAddress: bAdrs,
      },
    ];

    const saved = buildCachedRelationalFile(oldFile, 'file1.pdf', rs);

    expect(saved.relationals).toEqual([{ src: a, target: b, rule: { type: 'link' } }]);
    expect(saved.annotIdToFileInfo).toEqual({
      [a]: aAdrs,
      [b]: bAdrs,
    });
  });

  test('apply links from a same annotation', () => {
    const oldFile: CachedRelationalFile = {
      annotIdToFileInfo: {
        [a]: aAdrs,
      },
      relationals: [],
    };

    const rs: RelationalWithAddress[] = [
      {
        relational: {
          srcID: a,
          targetID: b,
          rule: { type: 'equal' },
        },
        srcAddress: aAdrs,
        targetAddress: bAdrs,
      },
      // file2.pdfは今回の更新対象ではないため、登録されないはず
      {
        relational: {
          srcID: b,
          targetID: c,
          rule: { type: 'link' },
        },
        srcAddress: bAdrs,
        targetAddress: cAdrs,
      },
    ];

    const saved = buildCachedRelationalFile(oldFile, 'file1.pdf', rs);

    expect(saved.relationals).toEqual([{ src: a, target: b, rule: { type: 'equal' } }]);
    expect(saved.annotIdToFileInfo).toEqual({
      [a]: aAdrs,
      [b]: bAdrs,
    });
  });

  test('remove links from a same annotation', () => {
    const oldFile: CachedRelationalFile = {
      annotIdToFileInfo: {
        [a]: aAdrs,
        [b]: bAdrs,
        [c]: cAdrs,
      },
      relationals: [
        { src: a, target: b, rule: { type: 'equal' } },
        { src: b, target: c, rule: { type: 'link' } },
        { src: c, target: a, rule: { type: 'link' } },
      ],
    };

    // file1.pdfからすべての関係性を削除した想定
    const rs: RelationalWithAddress[] = [];

    const saved = buildCachedRelationalFile(oldFile, 'file1.pdf', rs);

    expect(saved.relationals).toEqual([{ src: b, target: c, rule: { type: 'link' } }]);
    expect(saved.annotIdToFileInfo).toEqual({
      [b]: bAdrs,
      [c]: cAdrs,
    });
  });
});
