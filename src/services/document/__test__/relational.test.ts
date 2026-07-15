import { describe, test, expect } from 'bun:test';
import { DOMMatrix } from 'canvas';
import type { ContainerID } from 'src/models/container';

// relational.tsはPDF処理系（pdfjs-dist）を経由してDOMMatrix等のブラウザAPIに依存するため、
// 静的importより先にDOMMatrixを用意してからdynamic importで読み込む
global.DOMMatrix = DOMMatrix as unknown as typeof globalThis.DOMMatrix;

const { resolveCachedContainerID } = await import('../relational');

describe('resolveCachedContainerID', () => {
  const currentID = '00000000-0000-0000-0000-000000000001' as ContainerID;
  const staleID = '00000000-0000-0000-0000-000000000002' as ContainerID;
  const otherID = '00000000-0000-0000-0000-000000000003' as ContainerID;

  test('現在のコンテナIDと一致する場合はそのまま返す', () => {
    expect(resolveCachedContainerID(currentID, currentID, () => true)).toBe(currentID);
  });

  test('記録されたcIDがどのコンテナとしても登録されていない場合は現在のコンテナIDへ読み替える', () => {
    expect(resolveCachedContainerID(staleID, currentID, () => false)).toBe(currentID);
  });

  test('記録されたcIDが別コンテナとして現在も登録されている場合はそのまま維持する', () => {
    expect(resolveCachedContainerID(otherID, currentID, () => true)).toBe(otherID);
  });
});
