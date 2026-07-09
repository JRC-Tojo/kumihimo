import Dexie, { type Table } from 'dexie';
import type { ContainerElementFile } from 'src/models/container';
import { ContainerID } from 'src/models/container';
import type { AnnotationID } from 'src/models/document/pdf';
import type { Result } from 'src/models/error/result';
import { Failure, Success, toError } from 'src/models/error/result';
import type { Relational, RelationalWithAddress } from 'src/models/relational/common';
import type { AnnotationBaseAddress } from 'src/models/relational/fileSchema';

interface RelationalRecord {
  id: string;
  srcID: AnnotationID;
  srcContainerID: ContainerID;
  srcFilePath: string;
  targetID: AnnotationID;
  targetContainerID: ContainerID;
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
  srcAddress: AnnotationBaseAddress,
  targetAddress: AnnotationBaseAddress,
  isTemporary = true,
): RelationalRecord {
  const compositeKey = [
    relational.srcID,
    relational.targetID,
    srcAddress.cID,
    srcAddress.filePath,
    targetAddress.cID,
    targetAddress.filePath,
    JSON.stringify(relational.rule),
  ].join('|');

  return {
    id: compositeKey,
    srcID: relational.srcID,
    srcContainerID: srcAddress.cID,
    srcFilePath: srcAddress.filePath,
    targetID: relational.targetID,
    targetContainerID: targetAddress.cID,
    targetFilePath: targetAddress.filePath,
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
    return Failure(toError(error));
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
  relationalWithAddresses: RelationalWithAddress[],
): Promise<Result<void>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    await db.relationals.bulkPut(
      relationalWithAddresses.map(({ relational, srcAddress, targetAddress }) =>
        toRelationalRecord(relational, srcAddress, targetAddress, false),
      ),
    );
    return Success();
  } catch (error) {
    return Failure(toError(error));
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
        srcID: row.srcID,
        targetID: row.targetID,
        rule: row.rule,
      })),
    );
  } catch (error) {
    return Failure(toError(error));
  }
}

/**
 * 関係性を仮フラグつきで新規登録する
 */
export async function addRelational(
  relational: Relational,
  srcAddress: AnnotationBaseAddress,
  targetAddress: AnnotationBaseAddress,
): Promise<Result<void>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    await db.relationals.put(toRelationalRecord(relational, srcAddress, targetAddress, true));
    return Success();
  } catch (error) {
    return Failure(toError(error));
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
    return Failure(toError(error));
  }
}

/**
 * 特定ファイルの関係性を本保存し、保存済みの一覧を返す
 */
export async function commitRelationals(
  file: ContainerElementFile,
): Promise<Result<RelationalWithAddress[]>> {
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
        relational: {
          srcID: row.srcID,
          targetID: row.targetID,
          rule: row.rule,
        },
        srcAddress: {
          cID: ContainerID.parse(row.srcContainerID),
          filePath: row.srcFilePath,
        },
        targetAddress: {
          cID: ContainerID.parse(row.targetContainerID),
          filePath: row.targetFilePath,
        },
      })),
    );
  } catch (error) {
    return Failure(toError(error));
  }
}
