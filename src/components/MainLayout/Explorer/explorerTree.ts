import type { ContainerElement } from 'src/models/container';
import { Path } from 'src/utils/binary/path';

/**
 * 指定した親パスの直下の子要素だけを抽出する（`parentPath`が`null`の場合はルート直下）
 */
export function directChildrenOf(
  elements: Record<string, ContainerElement>,
  parentPath: string | null,
): ContainerElement[] {
  // parentPathがnull（ルート直下）の場合、Pathの親は正規化された起点である"."になる
  const targetParent = parentPath === null ? '.' : new Path(parentPath).path;

  return Object.values(elements).filter((e) => new Path(e.path).parent().path === targetParent);
}

/**
 * フォルダを先に、続いてファイルをパス名順に並べる（VSCode等と同様の一般的な並び順）
 */
export function sortElements(elements: ContainerElement[]): ContainerElement[] {
  return [...elements].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'Folder' ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
}
