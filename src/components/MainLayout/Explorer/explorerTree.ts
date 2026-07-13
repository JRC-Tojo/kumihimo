import type { ContainerElement } from 'src/models/container';

/**
 * 指定した親パスの直下の子要素だけを抽出する（`parentPath`が`null`の場合はルート直下）
 */
export function directChildrenOf(
  elements: Record<string, ContainerElement>,
  parentPath: string | null,
): ContainerElement[] {
  const all = Object.values(elements);

  if (parentPath === null) {
    return all.filter((e) => !e.path.includes('/'));
  }

  const prefix = `${parentPath}/`;
  return all
    .filter((e) => e.path.startsWith(prefix))
    .filter((e) => !e.path.slice(prefix.length).includes('/'));
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
