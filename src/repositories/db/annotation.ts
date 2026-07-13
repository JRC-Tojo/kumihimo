import type { Observable } from 'dexie';
import Dexie, { liveQuery, type Table } from 'dexie';
import type { ContainerElementFile, ContainerID } from 'src/models/container';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import type { Result } from 'src/models/error/result';
import { Failure, Success, toError } from 'src/models/error/result';
import type { AnnotationBaseAddress, AnnotationInfo } from 'src/models/relational/fileSchema';

interface AnnotationRecord {
  id: AnnotationID;
  containerID: ContainerID;
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
 * DBに記録されているアノテーションの元データを取得する
 */
async function getAnnotationRecord(annotID: AnnotationID): Promise<Result<AnnotationRecord>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    const record = await db.annotations.get(annotID);
    if (!record || record.isDeleted) return Failure(new Error('annotation not found'));
    return Success(record);
  } catch (error) {
    return Failure(toError(error));
  }
}

/**
 * DBからアノテーション情報を取得する
 */
export async function getAnnotationInfo(annotID: AnnotationID): Promise<Result<AnnotationInfo>> {
  const record = await getAnnotationRecord(annotID);
  if (!record.ok) return record;
  return Success(record.value.annotationInfo);
}

/**
 * DBからアノテーションの保存パスを取得する
 */
export async function getAnnotationAddress(
  annotID: AnnotationID,
): Promise<Result<AnnotationBaseAddress>> {
  const record = await getAnnotationRecord(annotID);
  if (!record.ok) return record;
  return Success({ cID: record.value.containerID, filePath: record.value.filePath });
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
    const rawedRecords = JSON.parse(
      JSON.stringify(aInfos.map((aInfo) => toAnnotationRecord(file, aInfo, true))),
    );
    await db.annotations.bulkPut(rawedRecords);
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
 * 特定ファイルに紐づく未保存（仮登録）のアノテーション件数を取得する
 */
export async function countTemporaryAnnotations(
  file: ContainerElementFile,
): Promise<Result<number>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    const count = await db.annotations
      .where('containerID')
      .equals(file.containerID)
      .filter((row) => row.filePath === file.path && row.isTemporary && !row.isDeleted)
      .count();
    return Success(count);
  } catch (error) {
    return Failure(toError(error));
  }
}

/**
 * DexieのLiveQueryを利用して特定ファイルのアノテーション情報を購読する
 */
export function observedAnnotationStylesByFile(
  file: ContainerElementFile,
): Observable<AnnotationStyle[]> {
  const observed = liveQuery(() =>
    db.annotations
      .where('containerID')
      .equals(file.containerID)
      .filter((row) => row.filePath === file.path && !row.isDeleted)
      .toArray((annotRec) => annotRec.map((annot) => annot.annotationInfo.style)),
  );

  return observed;
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
 * 特定ファイルのアノテーション記録のfilePathを付け替える（リネーム・移動時の追従用）
 */
export async function remapFilePath(
  containerID: ContainerID,
  oldPath: string,
  newPath: string,
): Promise<Result<void>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    await db.annotations
      .where('containerID')
      .equals(containerID)
      .filter((row) => row.filePath === oldPath)
      .modify({ filePath: newPath, updatedAt: new Date().toISOString() });
    return Success();
  } catch (error) {
    return Failure(toError(error));
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
