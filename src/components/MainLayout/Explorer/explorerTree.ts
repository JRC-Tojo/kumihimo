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

/**
 * リネーム後の名前が、同一階層（親フォルダ）内で他の要素と重複しないかを判定する
 *
 * 名前が空、または変更なし（現在と同名）の場合は重複チェック対象外としてtrueを返す
 * （空文字や無変更の扱いは呼び出し側のリネーム確定処理に委ねる）
 */
export function isSiblingNameAvailable(
  elements: Record<string, ContainerElement>,
  currentPath: string,
  newName: string,
): boolean {
  const trimmed = newName.trim();
  if (trimmed === '') return true;

  const candidatePath = new Path(currentPath).parent().child(trimmed).path;
  if (candidatePath === currentPath) return true;

  return elements[candidatePath] === undefined;
}
