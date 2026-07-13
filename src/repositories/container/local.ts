/**
 * File System Access APIを利用して、PC上の実フォルダをコンテナとして扱う
 */
import type { Container, ContainerElement, ContainerID, ContainerSkel } from 'src/models/container';
import { DocumentSource } from 'src/models/document/common';
import type { Result } from 'src/models/error/result';
import { Failure, Success, toError } from 'src/models/error/result';
import * as fsHandleDB from 'src/repositories/inMemory/fsHandleDB';
import { arrayBufferToBase64, base64ToUint8Array } from 'src/utils/binary/base64';
import { Path } from 'src/utils/binary/path';
import { fromEntries } from 'src/utils/obj/obj';

/** コンテナルートに配置する本システムの管理フォルダ名（一覧には含めない） */
const CONTAINER_CONFIG_FOLDER = '.rd';

/**
 * `pickDirectory()`で選択された直後のハンドルを一時的に保持する
 *
 * `createContainer('local', ...)`の呼び出し時（`saveContainer`）にこの値を取り出して永続化する。
 * ブラウザの「ユーザー操作の直後でなければピッカーを開けない」という制約上、
 * ピッカーを開く（`pickDirectory`）とコンテナ登録（`saveContainer`）は必ず一連のUI操作から
 * 続けて呼ばれる前提とする
 */
let lastPickedHandle: FileSystemDirectoryHandle | null = null;

/**
 * PC上の実フォルダを選択する（ユーザー操作から直接呼ぶこと）
 */
export async function pickDirectory(): Promise<Result<{ name: string }>> {
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    lastPickedHandle = handle;
    return Success({ name: handle.name });
  } catch (e) {
    return Failure(toError(e));
  }
}

/**
 * 既に取得済みのディレクトリハンドルを登録する
 *
 * `.code-workspace`読み込み時など、ディレクトリピッカー以外の経路で取得したハンドルを
 * `saveContainer()`で永続化できるようにするための入口
 */
export function registerHandle(handle: FileSystemDirectoryHandle): void {
  lastPickedHandle = handle;
}

/**
 * ローカルに保存されたコンテナを取得する
 *
 * 自身の永続ストア（fsHandleDB）のみを情報源とする（cache.tsと同じ考え方）
 */
export async function getContainers(): Promise<Result<ContainerSkel[]>> {
  const allRes = await fsHandleDB.getAllHandles();
  if (!allRes.ok) return allRes;
  return Success(allRes.value.map((h) => h.skel));
}

/**
 * ローカルに保存されたコンテナを削除する
 *
 * 実フォルダそのものは削除しない（コンテナとしての登録解除のみ）。
 * 実フォルダの削除は明示的な「フォルダを削除」操作でのみ行う
 */
export async function deleteContainer(c: ContainerSkel): Promise<Result<void>> {
  return fsHandleDB.deleteHandle(c.id);
}

/**
 * `pickDirectory()`で選択済みのハンドルをコンテナ情報として永続化する
 */
export async function saveContainer(c: ContainerSkel): Promise<Result<void>> {
  if (lastPickedHandle === null) {
    return Failure(new Error('No directory has been picked (call pickDirectory() first)'));
  }

  const handle = lastPickedHandle;
  lastPickedHandle = null;

  return fsHandleDB.setHandle(c.id, { skel: c, handle });
}

/**
 * コンテナへのアクセス許可状態を確認する
 */
export async function checkPermission(
  cId: ContainerID,
): Promise<Result<'granted' | 'prompt' | 'denied'>> {
  const handleRes = await fsHandleDB.getHandle(cId);
  if (!handleRes.ok) return handleRes;

  try {
    const state = await handleRes.value.handle.queryPermission({ mode: 'readwrite' });
    return Success(state);
  } catch (e) {
    return Failure(toError(e));
  }
}

/**
 * コンテナへのアクセス許可を再度要求する（ユーザー操作から直接呼ぶこと）
 */
export async function requestPermission(cId: ContainerID): Promise<Result<void>> {
  const handleRes = await fsHandleDB.getHandle(cId);
  if (!handleRes.ok) return handleRes;

  try {
    const state = await handleRes.value.handle.requestPermission({ mode: 'readwrite' });
    if (state !== 'granted') return Failure(new Error(`Permission was not granted (${state})`));
    return Success();
  } catch (e) {
    return Failure(toError(e));
  }
}

/**
 * ディレクトリハンドルの配下を、指定した相対パス分だけ辿る
 */
async function getDirectoryHandleByPath(
  root: FileSystemDirectoryHandle,
  dirPath: string,
  create: boolean,
): Promise<Result<FileSystemDirectoryHandle>> {
  const segments = dirPath.split('/').filter((seg) => seg !== '' && seg !== '.');

  try {
    let current = root;
    for (const seg of segments) {
      current = await current.getDirectoryHandle(seg, { create });
    }
    return Success(current);
  } catch (e) {
    return Failure(toError(e));
  }
}

/**
 * ファイルパスから、その親ディレクトリのハンドルとファイル名を取得する
 */
async function getParentDirectoryHandle(
  root: FileSystemDirectoryHandle,
  filePath: string,
  create: boolean,
): Promise<Result<{ dir: FileSystemDirectoryHandle; name: string }>> {
  const pathObj = new Path(filePath);
  const dirRes = await getDirectoryHandleByPath(root, pathObj.parent().path, create);
  if (!dirRes.ok) return dirRes;
  return Success({ dir: dirRes.value, name: pathObj.basename() });
}

/**
 * 指定ディレクトリ配下を再帰的に辿り、要素一覧を返す（本体データは読まずメタ情報のみ取得する）
 *
 * サブディレクトリは並行して辿ることで、深い階層構造でも取得時間を抑える
 */
async function walkDirectory(
  dirHandle: FileSystemDirectoryHandle,
  cId: ContainerID,
  relativePath: string,
): Promise<ContainerElement[]> {
  const elements: ContainerElement[] = [];
  const subDirWalks: Promise<ContainerElement[]>[] = [];

  for await (const [name, handle] of dirHandle.entries()) {
    // 本システムの管理フォルダはコンテナ要素一覧には含めない
    if (relativePath === '' && name === CONTAINER_CONFIG_FOLDER) continue;

    const entryPath = relativePath === '' ? name : `${relativePath}/${name}`;

    if (handle.kind === 'directory') {
      elements.push({ containerID: cId, type: 'Folder', path: entryPath, createdAt: new Date() });
      subDirWalks.push(walkDirectory(handle, cId, entryPath));
    } else {
      let fileSize: number | undefined;
      let updatedAt = new Date();
      try {
        const file = await handle.getFile();
        fileSize = file.size;
        updatedAt = new Date(file.lastModified);
      } catch {
        // メタ情報の取得に失敗しても一覧表示自体は継続する
      }
      elements.push({
        containerID: cId,
        type: 'File',
        path: entryPath,
        fileSize,
        createdAt: updatedAt,
        updatedAt,
        description: '',
        genre: '',
        tags: [],
      });
    }
  }

  const subResults = await Promise.all(subDirWalks);
  return elements.concat(subResults.flat());
}

/**
 * ローカルに保存されたコンテナの要素情報を取得する
 */
export async function loadContainerElements(c: ContainerSkel): Promise<Result<Container>> {
  const handleRes = await fsHandleDB.getHandle(c.id);
  if (!handleRes.ok) return handleRes;

  try {
    const flatElements = await walkDirectory(handleRes.value.handle, c.id, '');
    return Success({ ...c, elements: fromEntries(flatElements.map((e) => [e.path, e])) });
  } catch (e) {
    return Failure(toError(e));
  }
}

/**
 * ローカルにファイルの実態を追加する
 */
export async function createFile(
  c: Container,
  filePath: string,
  srcData: DocumentSource,
): Promise<Result<void>> {
  const handleRes = await fsHandleDB.getHandle(c.id);
  if (!handleRes.ok) return handleRes;

  const parentRes = await getParentDirectoryHandle(handleRes.value.handle, filePath, true);
  if (!parentRes.ok) return parentRes;

  const bytesRes = base64ToUint8Array(srcData);
  if (!bytesRes.ok) return bytesRes;

  try {
    const fileHandle = await parentRes.value.dir.getFileHandle(parentRes.value.name, {
      create: true,
    });
    const writable = await fileHandle.createWritable();
    // Uint8Arrayの型がTS上ArrayBufferLike（SharedArrayBuffer含む）で汎化されるため、
    // base64からのデコード結果（常に通常のArrayBuffer由来）であることを踏まえてキャストする
    await writable.write(bytesRes.value as unknown as BufferSource);
    await writable.close();
    return Success();
  } catch (e) {
    return Failure(toError(e));
  }
}

/**
 * ローカルからファイルの実態を削除する
 */
export async function deleteFile(c: Container, element: ContainerElement): Promise<Result<void>> {
  const handleRes = await fsHandleDB.getHandle(c.id);
  if (!handleRes.ok) return handleRes;

  const parentRes = await getParentDirectoryHandle(handleRes.value.handle, element.path, false);
  if (!parentRes.ok) return parentRes;

  try {
    await parentRes.value.dir.removeEntry(parentRes.value.name);
    return Success();
  } catch (e) {
    return Failure(toError(e));
  }
}

/**
 * ローカルにファイルの実態を読み込む
 */
export async function loadSrcData(cId: ContainerID, path: string): Promise<Result<DocumentSource>> {
  const handleRes = await fsHandleDB.getHandle(cId);
  if (!handleRes.ok) return handleRes;

  const parentRes = await getParentDirectoryHandle(handleRes.value.handle, path, false);
  if (!parentRes.ok) return parentRes;

  try {
    const fileHandle = await parentRes.value.dir.getFileHandle(parentRes.value.name);
    const file = await fileHandle.getFile();
    const base64Res = await arrayBufferToBase64(await file.arrayBuffer());
    if (!base64Res.ok) return base64Res;
    return Success(DocumentSource.parse(base64Res.value));
  } catch (e) {
    return Failure(toError(e));
  }
}

/**
 * ローカルにフォルダの実態を追加する
 */
export async function createFolder(c: Container, folderPath: string): Promise<Result<void>> {
  const handleRes = await fsHandleDB.getHandle(c.id);
  if (!handleRes.ok) return handleRes;

  const dirRes = await getDirectoryHandleByPath(handleRes.value.handle, folderPath, true);
  if (!dirRes.ok) return dirRes;
  return Success();
}

/**
 * ローカルからフォルダの実態を削除する（配下も含めて再帰的に削除する）
 */
export async function deleteFolder(c: Container, folderPath: string): Promise<Result<void>> {
  const handleRes = await fsHandleDB.getHandle(c.id);
  if (!handleRes.ok) return handleRes;

  const parentRes = await getParentDirectoryHandle(handleRes.value.handle, folderPath, false);
  if (!parentRes.ok) return parentRes;

  try {
    await parentRes.value.dir.removeEntry(parentRes.value.name, { recursive: true });
    return Success();
  } catch (e) {
    return Failure(toError(e));
  }
}

/**
 * ファイルを付け替える（コピー後、旧ファイルを削除する。ネイティブの`move()`が使える場合はそれを使う）
 */
async function moveFile(
  root: FileSystemDirectoryHandle,
  oldPath: string,
  newPath: string,
): Promise<Result<void>> {
  const oldParentRes = await getParentDirectoryHandle(root, oldPath, false);
  if (!oldParentRes.ok) return oldParentRes;
  const newParentRes = await getParentDirectoryHandle(root, newPath, true);
  if (!newParentRes.ok) return newParentRes;

  try {
    const oldFileHandle = await oldParentRes.value.dir.getFileHandle(oldParentRes.value.name);

    // 環境がネイティブのmove()に対応していれば、それを優先して使う
    const movable = oldFileHandle as FileSystemFileHandle & {
      move?: (dir: FileSystemDirectoryHandle, name: string) => Promise<void>;
    };
    if (typeof movable.move === 'function') {
      await movable.move(newParentRes.value.dir, newParentRes.value.name);
      return Success();
    }

    // フォールバック：新規作成してコピーした後、旧ファイルを削除する
    const file = await oldFileHandle.getFile();
    const newFileHandle = await newParentRes.value.dir.getFileHandle(newParentRes.value.name, {
      create: true,
    });
    const writable = await newFileHandle.createWritable();
    await writable.write(await file.arrayBuffer());
    await writable.close();
    await oldParentRes.value.dir.removeEntry(oldParentRes.value.name);

    return Success();
  } catch (e) {
    return Failure(toError(e));
  }
}

/**
 * 空になったフォルダを付け替える
 *
 * 呼び出し元（services/container/main.ts）は配下の要素を深い階層から先に処理してから
 * フォルダ自身を最後に処理する前提のため、この時点でフォルダの中身は既に空になっている
 */
async function moveEmptyFolder(
  root: FileSystemDirectoryHandle,
  oldPath: string,
  newPath: string,
): Promise<Result<void>> {
  const newDirRes = await getDirectoryHandleByPath(root, newPath, true);
  if (!newDirRes.ok) return newDirRes;

  const oldParentRes = await getParentDirectoryHandle(root, oldPath, false);
  if (!oldParentRes.ok) return oldParentRes;

  try {
    await oldParentRes.value.dir.removeEntry(oldParentRes.value.name, { recursive: true });
    return Success();
  } catch (e) {
    return Failure(toError(e));
  }
}

/**
 * ローカルのファイル・フォルダのパスを付け替える
 */
export async function renameEntry(
  c: Container,
  oldPath: string,
  newPath: string,
  isFolder: boolean,
): Promise<Result<void>> {
  const handleRes = await fsHandleDB.getHandle(c.id);
  if (!handleRes.ok) return handleRes;

  if (isFolder) return moveEmptyFolder(handleRes.value.handle, oldPath, newPath);
  return moveFile(handleRes.value.handle, oldPath, newPath);
}
