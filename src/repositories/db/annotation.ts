import Dexie, { liveQuery, type Table } from 'dexie';
import type { ContainerElementFile } from 'src/models/container';
import type { AnnotationID } from 'src/models/document/pdf';
import type { Result } from 'src/models/error/result';
import { Failure, Success } from 'src/models/error/result';
import type { AnnotationInfo } from 'src/models/relational/fileSchema';

interface AnnotationRecord {
  id: string;
  containerID: string;
  filePath: string;
  annotationInfo: AnnotationInfo;
  isTemporary: boolean;
  isDeleted: boolean;
  updatedAt: string;
}

class AnnotationDexieDB extends Dexie {
  annotations!: Table<AnnotationRecord, string>;

  constructor() {
    super('relational-documents-annotations');
    this.version(1).stores({
      annotations: 'id, containerID, filePath, isTemporary, isDeleted, updatedAt',
    });
  }
}

const db = new AnnotationDexieDB();

function toAnnotationRecord(
  file: ContainerElementFile,
  aInfo: AnnotationInfo,
  isTemporary = true,
): AnnotationRecord {
  return {
    id: aInfo.style.id,
    containerID: file.containerID,
    filePath: file.path,
    annotationInfo: aInfo,
    isTemporary,
    isDeleted: false,
    updatedAt: new Date().toISOString(),
  };
}

async function ensureReady(): Promise<Result<void>> {
  try {
    await db.open();
    return Success();
  } catch (error) {
    return Failure(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * 読み込み中の文書におけるアノテーション一覧を格納するDBを初期化する
 */
export async function initAnnotDB(): Promise<Result<void>> {
  return ensureReady();
}

/**
 * DBからアノテーション情報を取得する
 */
export async function getAnnotationInfo(annotID: AnnotationID): Promise<Result<AnnotationInfo>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    const record = await db.annotations.get(annotID);
    if (!record || record.isDeleted) return Failure(new Error('annotation not found'));
    return Success(record.annotationInfo);
  } catch (error) {
    return Failure(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * アノテーション情報を仮フラグ付きで追加する
 */
export async function addAnnotationInfo(
  file: ContainerElementFile,
  aInfo: AnnotationInfo,
): Promise<Result<void>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    await db.annotations.put(toAnnotationRecord(file, aInfo, true));
    return Success();
  } catch (error) {
    return Failure(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * アノテーション情報を仮フラグ付きで追加する
 */
export async function addAnnotationInfos(
  file: ContainerElementFile,
  aInfos: AnnotationInfo[],
): Promise<Result<void>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    await db.annotations.bulkPut(aInfos.map((aInfo) => toAnnotationRecord(file, aInfo, true)));
    return Success();
  } catch (error) {
    return Failure(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * 特定のファイルのアノテーション情報をDBから取得する
 */
export async function getAnnotationsByFile(
  file: ContainerElementFile,
): Promise<Result<AnnotationInfo[]>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    const rows = await db.annotations
      .where('containerID')
      .equals(file.containerID)
      .filter((row) => row.filePath === file.path && !row.isDeleted)
      .toArray();
    return Success(rows.map((row) => row.annotationInfo));
  } catch (error) {
    return Failure(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * DexieのLiveQueryを利用して特定ファイルのアノテーション情報を購読する
 */
export function observeAnnotationsByFile(
  file: ContainerElementFile,
  onChange: (aInfos: AnnotationInfo[]) => void,
): () => void {
  const subscription = liveQuery(() =>
    db.annotations
      .where('containerID')
      .equals(file.containerID)
      .filter((row) => row.filePath === file.path && !row.isDeleted)
      .toArray(),
  ).subscribe({
    next: (rows) => {
      onChange(rows.map((row) => row.annotationInfo));
    },
    error: (error) => {
      console.error('Failed to observe annotations', error);
    },
  });

  return () => subscription.unsubscribe();
}

/**
 * DBに格納されている特定ファイルのアノテーションを保存する（＝仮フラグを撤去する）
 */
export async function commitAnnotations(
  file?: ContainerElementFile,
): Promise<Result<AnnotationInfo[]>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    const query = file
      ? db.annotations
          .where('containerID')
          .equals(file.containerID)
          .filter((row) => row.filePath === file.path && row.isTemporary && !row.isDeleted)
      : db.annotations.filter((row) => row.isTemporary && !row.isDeleted);

    const rows = await query.toArray();
    if (rows.length === 0) return Success([]);

    await db.transaction('rw', db.annotations, async () => {
      await Promise.all(
        rows.map((row) =>
          db.annotations.update(row.id, {
            isTemporary: false,
            updatedAt: new Date().toISOString(),
          }),
        ),
      );
    });

    return Success(rows.map((row) => row.annotationInfo));
  } catch (error) {
    return Failure(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * 指定したアノテーションを仮フラグ付きで削除する
 */
export async function softRemoveAnnotation(annotID: AnnotationID): Promise<Result<void>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    const existing = await db.annotations.get(annotID);
    if (!existing) return Success();

    await db.annotations.update(annotID, {
      isDeleted: true,
      isTemporary: true,
      updatedAt: new Date().toISOString(),
    });
    return Success();
  } catch (error) {
    return Failure(error instanceof Error ? error : new Error(String(error)));
  }
}
