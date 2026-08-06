/**
 * ブックマーク（本システム側で登録する、文書内の特定ページへの目印）に関する処理
 *
 * PDF自体に埋め込まれたしおり（アウトライン、`PdfOutlineEntry`）とは独立した概念であり、
 * アノテーションと異なりセッション中の仮登録・明示的な保存操作を経由せず、登録・削除・
 * 改名のたびに`.kcfg`へ直接反映する（実体のバイト列は変わらないため、ハッシュ更新や
 * バックアップ作成の対象にはしない）
 */
import type { ContainerElementFile } from 'src/models/container';
import { Failure, NotFoundError, Success, type Result } from 'src/models/error/result';
import type { BookmarkID, BookmarkInfo } from 'src/models/relational/fileSchema';
import { BookmarkID as BookmarkIDSchema } from 'src/models/relational/fileSchema';
import * as containerConfigService from 'src/services/container/config';
import { loadConfig } from './config';

/** 指定ファイルに登録されているブックマーク一覧を取得する（ページ番号の昇順） */
export async function listBookmarks(file: ContainerElementFile): Promise<Result<BookmarkInfo[]>> {
  const configRes = await loadConfig(file);
  if (!configRes.ok) return configRes;

  return Success(
    Object.values(configRes.value.bookmarks).sort((a, b) => a.pageNumber - b.pageNumber),
  );
}

/** ブックマークを新規登録する */
export async function addBookmark(
  file: ContainerElementFile,
  title: string,
  pageNumber: number,
): Promise<Result<BookmarkInfo>> {
  const configRes = await loadConfig(file);
  if (!configRes.ok) return configRes;

  const newBookmark: BookmarkInfo = {
    id: BookmarkIDSchema.parse(crypto.randomUUID()),
    title,
    pageNumber,
  };
  const updatedBookmarks = { ...configRes.value.bookmarks, [newBookmark.id]: newBookmark };

  const saveRes = await containerConfigService.saveDocumentConfigFile(
    file.containerID,
    file.path,
    Object.values(configRes.value.annots),
    configRes.value.fileHash,
    updatedBookmarks,
  );
  if (!saveRes.ok) return saveRes;

  return Success(newBookmark);
}

/** ブックマークを削除する */
export async function removeBookmark(
  file: ContainerElementFile,
  bookmarkId: BookmarkID,
): Promise<Result<void>> {
  const configRes = await loadConfig(file);
  if (!configRes.ok) return configRes;

  const updatedBookmarks = { ...configRes.value.bookmarks };
  delete updatedBookmarks[bookmarkId];

  return containerConfigService.saveDocumentConfigFile(
    file.containerID,
    file.path,
    Object.values(configRes.value.annots),
    configRes.value.fileHash,
    updatedBookmarks,
  );
}

/** ブックマークの名称を変更する */
export async function renameBookmark(
  file: ContainerElementFile,
  bookmarkId: BookmarkID,
  newTitle: string,
): Promise<Result<void>> {
  const configRes = await loadConfig(file);
  if (!configRes.ok) return configRes;

  const target = configRes.value.bookmarks[bookmarkId];
  if (target === undefined) return Failure(new NotFoundError('Bookmark not found'));

  const updatedBookmarks = {
    ...configRes.value.bookmarks,
    [bookmarkId]: { ...target, title: newTitle },
  };

  return containerConfigService.saveDocumentConfigFile(
    file.containerID,
    file.path,
    Object.values(configRes.value.annots),
    configRes.value.fileHash,
    updatedBookmarks,
  );
}
