/**
 * エクスプローラーのドラッグ&ドロップ（ツリー内移動・OS外部ファイルのアップロード）を扱うcomposable
 */
import { ref } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import { useBackendApi } from 'src/apis/backendApi';
import type { ContainerElement, ContainerID } from 'src/models/container';
import { DocumentSource } from 'src/models/document/common';
import { arrayBufferToBase64 } from 'src/utils/binary/base64';
import { explorerKey } from 'src/stores/explorerStore';
import { syncStoresAfterRename } from 'src/utils/document/syncStoresAfterRename';
import { Path } from 'src/utils/binary/path';

/** 内部移動であることを識別するためのMIMEタイプ（値自体には移動元の要素キーを入れる） */
const INTERNAL_DND_TYPE = 'application/x-rd-explorer-element';

/**
 * ドラッグ中の要素の実体
 *
 * DataTransferにはシリアライズしたJSONではなく識別キーのみを載せ、実体はこのモジュール変数で
 * 保持する（Dateフィールド等がJSON往復で壊れるのを避けるため。同一ウィンドウ内のD&Dのみ対象）
 */
let draggedElement: ContainerElement | null = null;

function readEntryAsFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readDirEntriesOnce(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

/** `readEntries()`は1回の呼び出しで全件返るとは限らないため、空になるまで繰り返す */
async function readAllDirEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await readDirEntriesOnce(reader);
    if (batch.length === 0) break;
    all.push(...batch);
  }
  return all;
}

interface CollectedEntries {
  files: { path: string; file: File }[];
  folderPaths: string[];
}

/**
 * OSからドロップされたエントリ（ファイル/フォルダ）を再帰的に読み取る
 */
async function collectFromEntry(
  entry: FileSystemEntry,
  basePath: string,
): Promise<CollectedEntries> {
  if (entry.isFile) {
    const file = await readEntryAsFile(entry as FileSystemFileEntry);
    return { files: [{ path: basePath, file }], folderPaths: [] };
  }

  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const children = await readAllDirEntries(reader);
  const nested = await Promise.all(
    children.map((child) => collectFromEntry(child, `${basePath}/${child.name}`)),
  );

  return {
    files: nested.flatMap((n) => n.files),
    folderPaths: [basePath, ...nested.flatMap((n) => n.folderPaths)],
  };
}

/**
 * ツリー上の要素をドラッグ開始する際に、ドラッグ元のノードに設定するハンドラ
 *
 * ドロップ先の状態に依存しないため、`useExplorerDnd()`を経由せず単独でも使える
 */
export function startElementDrag(e: DragEvent, elem: ContainerElement): void {
  if (!e.dataTransfer) return;
  draggedElement = elem;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData(INTERNAL_DND_TYPE, explorerKey(elem.containerID, elem.path));
}

export interface UseExplorerDndOptions {
  containerId: ContainerID;
  /** ドロップ先フォルダのパス（コンテナ直下にドロップする場合は`null`） */
  targetFolderPath: () => string | null;
  /** 移動・アップロードが完了した後に呼ぶ（ツリーの再読込用） */
  onChanged: () => void | Promise<void>;
}

export function useExplorerDnd(options: UseExplorerDndOptions) {
  const api = useBackendApi();
  const $q = useQuasar();
  const { t } = useI18n();
  const isDragOver = ref(false);

  const onDragStartElement = startElementDrag;

  /** ドロップ先の上をドラッグ中であることを示すハイライト状態にする */
  function onDragOverTarget(e: DragEvent): void {
    e.preventDefault();
    isDragOver.value = true;
  }

  /** ドロップ先のハイライト状態を解除する */
  function onDragLeaveTarget(): void {
    isDragOver.value = false;
  }

  /**
   * 内部の要素移動を処理する。対象外の場合はfalseを返す
   */
  async function handleInternalMove(e: DragEvent): Promise<boolean> {
    if (!e.dataTransfer?.types.includes(INTERNAL_DND_TYPE)) return false;
    if (draggedElement === null) return true;

    const newParentPath = options.targetFolderPath() ?? '.';

    // 自分自身やその配下フォルダへの移動は無視する
    if (draggedElement.path === newParentPath) return true;
    if (draggedElement.type === 'Folder' && newParentPath.startsWith(`${draggedElement.path}/`)) {
      return true;
    }

    const movedElement = draggedElement;
    const moveRes = await api.moveElement(movedElement, newParentPath);
    draggedElement = null;
    if (moveRes.ok) syncStoresAfterRename(movedElement.containerID, moveRes.data);
    // ツリー再読込は呼び出し元のonDropTargetが一括で行うため、ここでは呼ばない
    return true;
  }

  /**
   * OS外部からドロップされたファイル/フォルダをアップロードする
   *
   * 失敗があっても処理は継続し（部分的に欠落したツリーを黙って成功扱いにしないよう）、
   * 失敗したパス一覧を返す。呼び出し側はこれを見てユーザーに通知する
   */
  async function handleExternalDrop(e: DragEvent): Promise<string[]> {
    if (!e.dataTransfer) return [];
    const items = Array.from(e.dataTransfer.items);
    const entries = items
      .map((item) => item.webkitGetAsEntry())
      .filter((entry): entry is FileSystemEntry => entry !== null);
    if (entries.length === 0) return [];

    const collected = await Promise.all(
      entries.map((entry) => collectFromEntry(entry, entry.name)),
    );
    const allFolderPaths = collected.flatMap((c) => c.folderPaths);
    const allFiles = collected.flatMap((c) => c.files);
    const failedPaths: string[] = [];

    // 深い階層から作られないよう、浅い階層から順にフォルダを作成する
    const sortedFolderPaths = [...allFolderPaths].sort(
      (a, b) => a.split('/').length - b.split('/').length,
    );
    const targetFolderPath = new Path(options.targetFolderPath() ?? '.');
    for (const folderPath of sortedFolderPaths) {
      const createRes = await api.createFolder(
        options.containerId,
        targetFolderPath.child(folderPath).path,
      );
      if (!createRes.ok) failedPaths.push(folderPath);
    }

    let lowConfidenceCount = 0;
    for (const { path, file } of allFiles) {
      const buffer = await file.arrayBuffer();
      const base64Res = await arrayBufferToBase64(buffer);
      if (!base64Res.ok) {
        failedPaths.push(path);
        continue;
      }

      const parsedSource = DocumentSource.safeParse(base64Res.value);
      if (!parsedSource.success) {
        failedPaths.push(path);
        continue;
      }

      const saveRes = await api.saveFile(
        options.containerId,
        targetFolderPath.child(path).path,
        parsedSource.data,
      );
      if (!saveRes.ok) {
        failedPaths.push(path);
        continue;
      }
      lowConfidenceCount += saveRes.data.retracking?.lowConfidenceCount ?? 0;
    }

    // 上書きアップロードにより自動追跡されたアノテーションのうち、精度が低いものがあれば確認を促す
    if (lowConfidenceCount > 0) {
      $q.notify({
        type: 'warning',
        message: t('explorer.retrackLowConfidence', { count: lowConfidenceCount }),
      });
    }

    return failedPaths;
  }

  /** ドロップを受け、内部移動・外部アップロードいずれかを処理してツリーを再読込する */
  async function onDropTarget(e: DragEvent): Promise<void> {
    e.preventDefault();
    isDragOver.value = false;

    const wasInternal = await handleInternalMove(e);
    if (!wasInternal) {
      const failedPaths = await handleExternalDrop(e);
      if (failedPaths.length > 0) {
        $q.notify({
          type: 'negative',
          message: t('explorer.uploadFailed', { names: failedPaths.join(', ') }),
        });
      }
    }

    await options.onChanged();
  }

  return {
    isDragOver,
    onDragStartElement,
    onDragOverTarget,
    onDragLeaveTarget,
    onDropTarget,
  };
}
