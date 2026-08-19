import Dexie, { type Table } from 'dexie';
import type { ContainerElementFile, ContainerID } from 'src/models/container';
import type { AnnotationID } from 'src/models/document/pdf';
import type {
  AnnotationGroup,
  AnnotationGroupID,
  GroupValueAggregation,
} from 'src/models/document/group';
import type { Result } from 'src/models/error/result';
import { Failure, NotFoundError, Success, toError } from 'src/models/error/result';
import type { AnnotationBaseAddress } from 'src/models/relational/fileSchema';

/**
 * グループのグローバルキャッシュ（`.kcfg`の`groups`から`loadConfig`のたびに同期される）
 *
 * このキャッシュは「グループの一覧」の正とはしない（正は`.kcfg`の`config.groups`）。
 * 目的は関係性（Relational）機能が個々のAnnotationID同様、グループIDだけからアドレス
 * （コンテナID・ファイルパス）とメンバー・集計方法を引けるようにすること
 */
interface AnnotationGroupRecord {
  id: AnnotationGroupID;
  containerID: ContainerID;
  filePath: string;
  memberIds: AnnotationID[];
  valueAggregation?: GroupValueAggregation;
  updatedAt: string;
}

export interface AnnotationGroupCacheEntry {
  address: AnnotationBaseAddress;
  memberIds: AnnotationID[];
  valueAggregation?: GroupValueAggregation;
}

class AnnotationGroupDexieDB extends Dexie {
  groups!: Table<AnnotationGroupRecord, string>;

  constructor() {
    super('relational-documents-annotation-groups');
    this.version(1).stores({
      groups: 'id, containerID, filePath',
    });
  }
}

const db = new AnnotationGroupDexieDB();

function toRecord(file: ContainerElementFile, group: AnnotationGroup): AnnotationGroupRecord {
  return {
    id: group.id,
    containerID: file.containerID,
    filePath: file.path,
    memberIds: group.memberIds,
    ...(group.valueAggregation !== undefined && { valueAggregation: group.valueAggregation }),
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
 * グループキャッシュDBを初期化する
 */
export async function initAnnotationGroupDB(): Promise<Result<void>> {
  return ensureReady();
}

/**
 * 指定ファイルのグループ一覧をキャッシュへ同期する
 *
 * `.kcfg`の`groups`を正として、キャッシュ上に残っている当該ファイルの古いレコードのうち
 * 今回渡されなかったもの（＝解散済み）は削除し、渡された分をbulkPutで反映する
 */
export async function upsertGroups(
  file: ContainerElementFile,
  groups: AnnotationGroup[],
): Promise<Result<void>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    await db.transaction('rw', db.groups, async () => {
      const existing = await db.groups
        .where('containerID')
        .equals(file.containerID)
        .filter((row) => row.filePath === file.path)
        .primaryKeys();
      const newIds = new Set(groups.map((g) => g.id));
      const toDelete = existing.filter((id) => !newIds.has(id as AnnotationGroupID));
      if (toDelete.length > 0) await db.groups.bulkDelete(toDelete);

      if (groups.length > 0) {
        const records = JSON.parse(JSON.stringify(groups.map((g) => toRecord(file, g))));
        await db.groups.bulkPut(records);
      }
    });
    return Success();
  } catch (error) {
    return Failure(toError(error));
  }
}

/**
 * グループIDからキャッシュ済みのアドレス・メンバー・集計方法を取得する
 */
export async function getGroup(
  groupId: AnnotationGroupID,
): Promise<Result<AnnotationGroupCacheEntry>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    const record = await db.groups.get(groupId);
    if (!record) return Failure(new NotFoundError('annotation group not found'));
    return Success({
      address: { cID: record.containerID, filePath: record.filePath },
      memberIds: record.memberIds,
      ...(record.valueAggregation !== undefined && { valueAggregation: record.valueAggregation }),
    });
  } catch (error) {
    return Failure(toError(error));
  }
}

/**
 * グループのキャッシュレコードを削除する（グループ解散時に使う）
 */
export async function removeGroup(groupId: AnnotationGroupID): Promise<Result<void>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    await db.groups.delete(groupId);
    return Success();
  } catch (error) {
    return Failure(toError(error));
  }
}

/**
 * ファイルのリネーム・移動に伴い、キャッシュ済みグループ記録のfilePathを付け替える
 */
export async function remapFilePath(
  containerID: ContainerID,
  oldPath: string,
  newPath: string,
): Promise<Result<void>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    await db.groups
      .where('containerID')
      .equals(containerID)
      .filter((row) => row.filePath === oldPath)
      .modify({ filePath: newPath, updatedAt: new Date().toISOString() });
    return Success();
  } catch (error) {
    return Failure(toError(error));
  }
}
