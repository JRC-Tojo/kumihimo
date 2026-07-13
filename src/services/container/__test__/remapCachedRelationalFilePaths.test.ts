import { describe, test, expect } from 'bun:test';
import { remapCachedRelationalFilePaths } from '../config';
import type { CachedRelationalFile } from 'src/models/relational/fileSchema';
import type { ContainerID } from 'src/models/container';
import type { AnnotationID } from 'src/models/document/pdf';

describe('remapCachedRelationalFilePaths', () => {
  const cID = '00000000-0000-0000-0000-000000000000' as ContainerID;
  const a = '00000000-0000-0000-0000-000000000001' as AnnotationID;
  const b = '00000000-0000-0000-0000-000000000002' as AnnotationID;

  test('renames the filePath of annotations under the given old path', () => {
    const oldFile: CachedRelationalFile = {
      annotIdToFileInfo: {
        [a]: { cID, filePath: 'folder/old.pdf' },
        [b]: { cID, filePath: 'other.pdf' },
      },
      relationals: [{ src: a, target: b, rule: { type: 'link' } }],
    };

    const result = remapCachedRelationalFilePaths(oldFile, { 'folder/old.pdf': 'folder/new.pdf' });

    expect(result.annotIdToFileInfo).toEqual({
      [a]: { cID, filePath: 'folder/new.pdf' },
      [b]: { cID, filePath: 'other.pdf' },
    });
    // relationals自体（AnnotationIDの組み合わせ）は変化しない
    expect(result.relationals).toEqual(oldFile.relationals);
  });

  test('leaves entries unchanged when their path is not in the map', () => {
    const oldFile: CachedRelationalFile = {
      annotIdToFileInfo: { [a]: { cID, filePath: 'untouched.pdf' } },
      relationals: [],
    };

    const result = remapCachedRelationalFilePaths(oldFile, { 'other.pdf': 'renamed.pdf' });

    expect(result.annotIdToFileInfo).toEqual(oldFile.annotIdToFileInfo);
  });
});
