import Dexie, { type Table } from 'dexie';
import type { ContainerElementFile } from 'src/models/container';
import { ContainerID } from 'src/models/container';
import type { Result } from 'src/models/error/result';
import { Failure, Success, toError } from 'src/models/error/result';
import type { Relational, RelationalWithAddress } from 'src/models/relational/common';
import type { AnnotationBaseAddress, RelationalEndpointID } from 'src/models/relational/fileSchema';

interface RelationalRecord {
  id: string;
  srcID: RelationalEndpointID;
  srcContainerID: ContainerID;
  srcFilePath: string;
  targetID: RelationalEndpointID;
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

function toRelationalWithAddress(row: RelationalRecord): RelationalWithAddress {
  return {
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
 * 指定ファイルがsrc・target問わずどちらかの側で関わっているRelational一覧をDBから取得して返す
 */
export async function getRelationalsInvolvingFile(
  file: ContainerElementFile,
): Promise<Result<RelationalWithAddress[]>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    const [srcRows, targetRows] = await Promise.all([
      db.relationals
        .where('srcContainerID')
        .equals(file.containerID)
        .filter((row) => row.srcFilePath === file.path && !row.isDeleted)
        .toArray(),
      db.relationals
        .where('targetContainerID')
        .equals(file.containerID)
        .filter((row) => row.targetFilePath === file.path && !row.isDeleted)
        .toArray(),
    ]);

    // src・target両方が同一ファイル内の場合に重複するため、行idでユニーク化する
    const rowsById = new Map([...srcRows, ...targetRows].map((row) => [row.id, row]));

    return Success(Array.from(rowsById.values()).map(toRelationalWithAddress));
  } catch (error) {
    return Failure(toError(error));
  }
}

/**
 * 指定ファイルがsrc・target問わずどちらかの側で関わる未保存（仮登録）の関係性件数を取得する
 */
export async function countTemporaryRelationalsInvolvingFile(
  file: ContainerElementFile,
): Promise<Result<number>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    const [srcRows, targetRows] = await Promise.all([
      db.relationals
        .where('srcContainerID')
        .equals(file.containerID)
        .filter((row) => row.srcFilePath === file.path && row.isTemporary && !row.isDeleted)
        .toArray(),
      db.relationals
        .where('targetContainerID')
        .equals(file.containerID)
        .filter((row) => row.targetFilePath === file.path && row.isTemporary && !row.isDeleted)
        .toArray(),
    ]);

    const rowsById = new Map([...srcRows, ...targetRows].map((row) => [row.id, row]));
    return Success(rowsById.size);
  } catch (error) {
    return Failure(toError(error));
  }
}

/**
 * 特定ファイルに関わる関係性記録のfilePathを付け替える（リネーム・移動時の追従用）
 *
 * `id`はfilePathを含む複合キーのため、`.modify()`ではなく削除→再登録で付け替える
 */
export async function remapFilePath(
  containerID: ContainerID,
  oldPath: string,
  newPath: string,
): Promise<Result<void>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    await db.transaction('rw', db.relationals, async () => {
      const asSrc = await db.relationals
        .where('srcContainerID')
        .equals(containerID)
        .filter((row) => row.srcFilePath === oldPath)
        .toArray();
      const asTarget = await db.relationals
        .where('targetContainerID')
        .equals(containerID)
        .filter((row) => row.targetFilePath === oldPath)
        .toArray();
      const rowsById = new Map([...asSrc, ...asTarget].map((row) => [row.id, row]));

      for (const row of rowsById.values()) {
        const updated: RelationalRecord = {
          ...row,
          srcFilePath: row.srcFilePath === oldPath ? newPath : row.srcFilePath,
          targetFilePath: row.targetFilePath === oldPath ? newPath : row.targetFilePath,
        };
        updated.id = [
          updated.srcID,
          updated.targetID,
          updated.srcContainerID,
          updated.srcFilePath,
          updated.targetContainerID,
          updated.targetFilePath,
          JSON.stringify(updated.rule),
        ].join('|');

        await db.relationals.delete(row.id);
        await db.relationals.put(updated);
      }
    });
    return Success();
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
 * srcID・targetIDが一致する1本の関係性のみを仮削除としてマークする
 *
 * softRemoveRelationalsBySrcIDは対象アノテーションが持つ全ての関係性を削除するが、
 * こちらは特定の1エッジのみを対象にする（リンクの変更・個別削除用）
 */
export async function softRemoveRelationalEdge(
  srcID: RelationalEndpointID,
  targetID: RelationalEndpointID,
): Promise<Result<void>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    await db.relationals
      .where('srcID')
      .equals(srcID)
      .filter((row) => row.targetID === targetID && !row.isDeleted)
      .modify({
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
 * 指定したアノテーションがsrc・target問わずどちらかの側で関わる関係性をすべて仮削除としてマークする
 *
 * アノテーション自体が削除された際に、紐づく関係性を孤立させないためのクリーンアップ用
 */
export async function softRemoveRelationalsByAnnotationID(
  annotID: RelationalEndpointID,
): Promise<Result<void>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    const updatedAt = new Date().toISOString();
    await db.transaction('rw', db.relationals, async () => {
      await db.relationals
        .where('srcID')
        .equals(annotID)
        .modify({ isDeleted: true, isTemporary: true, updatedAt });
      await db.relationals
        .where('targetID')
        .equals(annotID)
        .modify({ isDeleted: true, isTemporary: true, updatedAt });
    });
    return Success();
  } catch (error) {
    return Failure(toError(error));
  }
}

/**
 * 指定ファイルがsrc・target問わず関わる関係性DBレコードをすべて削除する
 *
 * 「保存せず閉じる」際、仮登録・確定済み問わずこのファイルが関わる記録を一旦すべて消し去り、
 * `.kumihimo/relational.json`（コンテナルートのキャッシュ）から読み直して確定済み状態を
 * 再構築するために使う
 */
export async function deleteRelationalsInvolvingFile(
  file: ContainerElementFile,
): Promise<Result<void>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    await db.transaction('rw', db.relationals, async () => {
      await db.relationals
        .where('srcContainerID')
        .equals(file.containerID)
        .filter((row) => row.srcFilePath === file.path)
        .delete();
      await db.relationals
        .where('targetContainerID')
        .equals(file.containerID)
        .filter((row) => row.targetFilePath === file.path)
        .delete();
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

    return Success(rows.map(toRelationalWithAddress));
  } catch (error) {
    return Failure(toError(error));
  }
}
