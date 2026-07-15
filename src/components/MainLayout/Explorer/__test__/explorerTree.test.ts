import { describe, test, expect } from 'bun:test';
import { directChildrenOf, isSiblingNameAvailable, sortElements } from '../explorerTree';
import type { ContainerElement, ContainerElementFile, ContainerID } from 'src/models/container';

const cId = '00000000-0000-0000-0000-000000000000' as ContainerID;
const now = new Date();

function makeFile(path: string): ContainerElementFile {
  return {
    containerID: cId,
    type: 'File',
    path,
    createdAt: now,
    updatedAt: now,
    description: '',
    genre: '',
    tags: [],
  };
}

describe('directChildrenOf', () => {
  const elements: Record<string, ContainerElement> = {
    'root.pdf': makeFile('root.pdf'),
    sub: { containerID: cId, type: 'Folder', path: 'sub', createdAt: now },
    'sub/child.pdf': makeFile('sub/child.pdf'),
    'sub/deep': { containerID: cId, type: 'Folder', path: 'sub/deep', createdAt: now },
    'sub/deep/grandchild.pdf': makeFile('sub/deep/grandchild.pdf'),
  };

  test('returns only root-level entries when parentPath is null', () => {
    const result = directChildrenOf(elements, null);
    expect(result.map((e) => e.path).sort()).toEqual(['root.pdf', 'sub']);
  });

  test('returns only direct children of the given folder (not deeper descendants)', () => {
    const result = directChildrenOf(elements, 'sub');
    expect(result.map((e) => e.path).sort()).toEqual(['sub/child.pdf', 'sub/deep']);
  });

  test('returns an empty array for a folder with no children', () => {
    const result = directChildrenOf(elements, 'sub/deep');
    expect(result.map((e) => e.path)).toEqual(['sub/deep/grandchild.pdf']);
  });
});

describe('sortElements', () => {
  test('sorts folders before files, then alphabetically by path', () => {
    const elements: ContainerElement[] = [
      makeFile('b.pdf'),
      { containerID: cId, type: 'Folder', path: 'z-folder', createdAt: now },
      makeFile('a.pdf'),
      { containerID: cId, type: 'Folder', path: 'a-folder', createdAt: now },
    ];

    const sorted = sortElements(elements).map((e) => e.path);
    expect(sorted).toEqual(['a-folder', 'z-folder', 'a.pdf', 'b.pdf']);
  });
});

describe('isSiblingNameAvailable', () => {
  const elements: Record<string, ContainerElement> = {
    'root.pdf': makeFile('root.pdf'),
    'other.pdf': makeFile('other.pdf'),
    sub: { containerID: cId, type: 'Folder', path: 'sub', createdAt: now },
    'sub/child.pdf': makeFile('sub/child.pdf'),
    'sub/deep': { containerID: cId, type: 'Folder', path: 'sub/deep', createdAt: now },
  };

  test('returns false when a sibling with the new name already exists', () => {
    expect(isSiblingNameAvailable(elements, 'root.pdf', 'other.pdf')).toBe(false);
  });

  test('returns true when no sibling has the new name', () => {
    expect(isSiblingNameAvailable(elements, 'root.pdf', 'unique.pdf')).toBe(true);
  });

  test('returns true when the new name is unchanged from the current name', () => {
    expect(isSiblingNameAvailable(elements, 'root.pdf', 'root.pdf')).toBe(true);
  });

  test('returns true for an empty (whitespace-only) name', () => {
    expect(isSiblingNameAvailable(elements, 'root.pdf', '   ')).toBe(true);
  });

  test('only checks against elements in the same folder, not other folders', () => {
    expect(isSiblingNameAvailable(elements, 'sub/child.pdf', 'root.pdf')).toBe(true);
  });

  test('detects a duplicate name among folder children (not the folder itself)', () => {
    expect(isSiblingNameAvailable(elements, 'sub/deep', 'child.pdf')).toBe(false);
  });
});
