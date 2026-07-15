import { describe, test, expect } from 'bun:test';
import { directChildrenOf, sortElements } from '../explorerTree';
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
