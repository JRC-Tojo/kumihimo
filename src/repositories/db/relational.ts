import Dexie, { type Table } from 'dexie';
import { ContainerID } from 'src/models/container';
import type { ContainerElementFile, ContainerID as ContainerIDType } from 'src/models/container';
import type { Result } from 'src/models/error/result';
import { Failure, Success } from 'src/models/error/result';
import type { Relational } from 'src/models/relational/common';

interface RelationalRecord {
  id: string;
  containerID: string;
  filePath: string;
  srcID: string;
  srcContainerID: string;
  srcFilePath: string;
  targetID: string;
  targetContainerID: string;
  targetFilePath: string;
  rule: Relational['rule'];
  isTemporary: boolean;
  isDeleted: boolean;
  updatedAt: string;
}

class RelationalDexieDB extends Dexie {
  relationals!: Table<RelationalRecord, string>;

  constructor() {
    super('relational-documents-relationals');
    this.version(1).stores({
      relationals:
        'id, srcID, srcContainerID, srcFilePath, targetID, targetContainerID, targetFilePath, containerID, filePath, isTemporary, isDeleted, updatedAt',
    });
  }
}

const db = new RelationalDexieDB();

function toRelationalRecord(
  relational: Relational,
  isTemporary = true,
  containerID?: ContainerIDType,
  filePath?: string,
): RelationalRecord {
  const compositeKey = [
    relational.srcID,
    relational.targetID,
    relational.srcFile.cID,
    relational.srcFile.filePath,
    relational.targetFile.cID,
    relational.targetFile.filePath,
    JSON.stringify(relational.rule),
  ].join('|');

  return {
    id: compositeKey,
    containerID: containerID ?? relational.srcFile.cID,
    filePath: filePath ?? relational.srcFile.filePath,
    srcID: relational.srcID,
    srcContainerID: relational.srcFile.cID,
    srcFilePath: relational.srcFile.filePath,
    targetID: relational.targetID,
    targetContainerID: relational.targetFile.cID,
    targetFilePath: relational.targetFile.filePath,
    rule: relational.rule,
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
 * 読み込み中の関係性情報をすべて管理するDBを初期化する
 */
export async function initRelationalDB(): Promise<Result<void>> {
  return ensureReady();
}

/**
 * キャッシュから読み込んだ関係性情報をDBに登録する
 */
export async function addCachedRelationals(
  cID: ContainerIDType,
  relationals: Relational[],
): Promise<Result<void>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    await db.relationals.bulkPut(
      relationals.map((relational) =>
        toRelationalRecord(relational, false, cID, relational.srcFile.filePath),
      ),
    );
    return Success();
  } catch (error) {
    return Failure(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * 特定のファイルをsource側とするRelational一覧をDBから取得して返す
 */
export async function getRelationalsByFile(
  file: ContainerElementFile,
): Promise<Result<Relational[]>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    const rows = await db.relationals
      .where('srcContainerID')
      .equals(file.containerID)
      .filter((row) => row.srcFilePath === file.path && !row.isDeleted)
      .toArray();

    return Success(
      rows.map((row) => ({
        srcFile: { cID: ContainerID.parse(row.srcContainerID), filePath: row.srcFilePath },
        srcID: row.srcID as Relational['srcID'],
        targetFile: { cID: ContainerID.parse(row.targetContainerID), filePath: row.targetFilePath },
        targetID: row.targetID as Relational['targetID'],
        rule: row.rule,
      })),
    );
  } catch (error) {
    return Failure(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * 関係性を仮フラグつきで新規登録する
 */
export async function addRelational(relational: Relational): Promise<Result<void>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    await db.relationals.put(toRelationalRecord(relational, true));
    return Success();
  } catch (error) {
    return Failure(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * 指定したアノテーションIDに紐づく関係性を仮削除としてマークする
 */
export async function softRemoveRelationalsBySrcID(srcID: string): Promise<Result<void>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    await db.relationals.where('srcID').equals(srcID).modify({
      isDeleted: true,
      isTemporary: true,
      updatedAt: new Date().toISOString(),
    });
    return Success();
  } catch (error) {
    return Failure(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * 特定ファイルの関係性を本保存し、保存済みの一覧を返す
 */
export async function commitRelationals(file: ContainerElementFile): Promise<Result<Relational[]>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    const rows = await db.relationals
      .where('srcContainerID')
      .equals(file.containerID)
      .filter((row) => row.srcFilePath === file.path && row.isTemporary && !row.isDeleted)
      .toArray();

    if (rows.length === 0) return Success([]);

    await db.transaction('rw', db.relationals, async () => {
      await Promise.all(
        rows.map((row) =>
          db.relationals.update(row.id, {
            isTemporary: false,
            updatedAt: new Date().toISOString(),
          }),
        ),
      );
    });

    return Success(
      rows.map((row) => ({
        srcFile: { cID: ContainerID.parse(row.srcContainerID), filePath: row.srcFilePath },
        srcID: row.srcID as Relational['srcID'],
        targetFile: { cID: ContainerID.parse(row.targetContainerID), filePath: row.targetFilePath },
        targetID: row.targetID as Relational['targetID'],
        rule: row.rule,
      })),
    );
  } catch (error) {
    return Failure(error instanceof Error ? error : new Error(String(error)));
  }
}
