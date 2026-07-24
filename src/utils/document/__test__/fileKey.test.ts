import { describe, expect, it } from 'bun:test';
import type { ContainerID } from 'src/models/container';
import { fileKey } from '../fileKey';

const containerID = '11111111-1111-4111-8111-111111111111' as ContainerID;
const otherContainerID = '22222222-2222-4222-8222-222222222222' as ContainerID;

describe('fileKey', () => {
  it('containerIDとPath正規化済みのpathを"|"で連結したキーを返す', () => {
    expect(fileKey({ containerID, path: 'a/b.pdf' })).toBe(`${containerID}|a/b.pdf`);
  });

  it('区切り文字表記が揺れていても同じキーになる（Pathで正規化される）', () => {
    const key1 = fileKey({ containerID, path: 'a/b/c.pdf' });
    const key2 = fileKey({ containerID, path: 'a\\b\\c.pdf' });
    const key3 = fileKey({ containerID, path: 'a//b///c.pdf' });
    expect(key2).toBe(key1);
    expect(key3).toBe(key1);
  });

  it('同じpathでもcontainerIDが異なれば別のキーになる', () => {
    const key1 = fileKey({ containerID, path: 'a.pdf' });
    const key2 = fileKey({ containerID: otherContainerID, path: 'a.pdf' });
    expect(key1).not.toBe(key2);
  });
});
