/**
 * アノテーションのグループ化に関する処理
 *
 * 複数のアノテーションをまとめて単一のオブジェクトのように扱えるようにする。ブックマークと
 * 同様、アノテーションと異なりセッション中の仮登録・明示的な保存操作を経由せず、
 * グループ化・グループ解除・値算出方法の変更のたびに`.kcfg`へ直接反映する。
 *
 * グループのネストは許可しない（1階層のみ）。既存グループを含む選択を再度グループ化した場合は、
 * 対象グループを解散してメンバーを展開し、新しい1つのフラットなグループとして作り直す
 */
import dayjs from 'dayjs';
import type { ContainerElementFile, ContainerID } from 'src/models/container';
import type { AnnotationID } from 'src/models/document/pdf';
import type {
  AnnotationGroup,
  AnnotationGroupID,
  GroupValueAggregation,
} from 'src/models/document/group';
import { AnnotationGroupID as AnnotationGroupIDSchema } from 'src/models/document/group';
import { Failure, NotFoundError, Success, type Result } from 'src/models/error/result';
import type { AnnotationBaseAddress } from 'src/models/relational/fileSchema';
import * as containerConfigService from 'src/services/container/config';
import * as annotationGroupRepository from 'src/repositories/db/annotationGroup';
import { loadConfig } from './config';

/**
 * グループ化には最低これだけのメンバーが必要
 */
const MIN_GROUP_MEMBERS = 2;

/**
 * 指定ファイルに登録されているグループ一覧を取得する
 */
export async function listAnnotationGroups(
  file: ContainerElementFile,
): Promise<Result<AnnotationGroup[]>> {
  const configRes = await loadConfig(file);
  if (!configRes.ok) return configRes;

  return Success(Object.values(configRes.value.groups));
}

/**
 * 指定ファイル内の特定グループを取得する
 */
export async function getAnnotationGroup(
  file: ContainerElementFile,
  groupId: AnnotationGroupID,
): Promise<Result<AnnotationGroup>> {
  const configRes = await loadConfig(file);
  if (!configRes.ok) return configRes;

  const group = configRes.value.groups[groupId];
  if (group === undefined) return Failure(new NotFoundError('Annotation group not found'));

  return Success(group);
}

/**
 * 指定したアノテーションが所属するグループを探す（所属していない場合は`undefined`）
 */
export async function getGroupContaining(
  file: ContainerElementFile,
  annotId: AnnotationID,
): Promise<Result<AnnotationGroup | undefined>> {
  const configRes = await loadConfig(file);
  if (!configRes.ok) return configRes;

  const found = Object.values(configRes.value.groups).find((g) => g.memberIds.includes(annotId));
  return Success(found);
}

/**
 * グループIDからそのグループが保存されているファイルのアドレスを取得する
 *
 * `annotationService.getAnnotationAddress`のグループ版。関係性（Relational）が
 * グループを端点とする場合のアドレス解決に使う
 */
export async function getGroupAddress(
  groupId: AnnotationGroupID,
): Promise<Result<AnnotationBaseAddress>> {
  const entry = await annotationGroupRepository.getGroup(groupId);
  if (!entry.ok) return entry;
  return Success(entry.value.address);
}

/**
 * グループIDから、アドレス・メンバー・値算出方法をまとめて取得する
 *
 * 関係性の検証（`resolveEndpointRawValue`）で、グループの代表値を算出するために使う
 */
export async function getGroupRecord(
  groupId: AnnotationGroupID,
): Promise<Result<annotationGroupRepository.AnnotationGroupCacheEntry>> {
  return annotationGroupRepository.getGroup(groupId);
}

/**
 * 設定ファイルの`groups`から指定したグループ群を取り除いた内容を返す（純粋関数）
 */
function withoutGroups(
  groups: Record<string, AnnotationGroup>,
  idsToRemove: Set<string>,
): Record<string, AnnotationGroup> {
  const result = { ...groups };
  idsToRemove.forEach((id) => delete result[id]);
  return result;
}

/**
 * 複数のアノテーションをグループ化する
 *
 * 選択範囲に既存グループのメンバーが含まれていた場合、そのグループは解散して
 * メンバーを新しいグループへ統合する（ネストは発生させない）。呼び出し側は戻り値の
 * `dissolvedGroupIds`について、関係性の孤立除去（`relationalService.removeRelationalsForAnnotation`）
 * を実行すること（レイヤー境界を越えた呼び出しになるため、循環importを避けてここでは行わない）
 */
export async function groupAnnotations(
  file: ContainerElementFile,
  annotationIds: AnnotationID[],
): Promise<Result<{ group: AnnotationGroup; dissolvedGroupIds: AnnotationGroupID[] }>> {
  const configRes = await loadConfig(file);
  if (!configRes.ok) return configRes;

  const candidate = new Set(annotationIds);
  const existingGroups = Object.values(configRes.value.groups);
  const dissolvedGroupIds: AnnotationGroupID[] = [];

  existingGroups.forEach((g) => {
    const overlaps = g.memberIds.some((id) => candidate.has(id));
    if (!overlaps) return;
    dissolvedGroupIds.push(g.id);
    g.memberIds.forEach((id) => candidate.add(id));
  });

  if (candidate.size < MIN_GROUP_MEMBERS) {
    return Failure(new Error(`グループ化には最低${MIN_GROUP_MEMBERS}件のアノテーションが必要です`));
  }

  const idRes = AnnotationGroupIDSchema.safeParse(crypto.randomUUID());
  if (!idRes.success) return Failure(idRes.error);

  const now = dayjs().toISOString();
  const newGroup: AnnotationGroup = {
    id: idRes.data,
    memberIds: Array.from(candidate),
    valueAggregation: undefined,
    createdAt: now,
    updatedAt: now,
  };

  const updatedGroups = {
    ...withoutGroups(configRes.value.groups, new Set(dissolvedGroupIds)),
    [newGroup.id]: newGroup,
  };

  const saveRes = await containerConfigService.saveDocumentConfigFile(
    file.containerID,
    file.path,
    Object.values(configRes.value.annots),
    configRes.value.fileHash,
    configRes.value.bookmarks,
    updatedGroups,
    configRes.value.outlineImported ?? false,
  );
  if (!saveRes.ok) return saveRes;

  const cacheRes = await annotationGroupRepository.upsertGroups(file, Object.values(updatedGroups));
  if (!cacheRes.ok) return cacheRes;

  return Success({ group: newGroup, dissolvedGroupIds });
}

/**
 * グループを解除する
 *
 * 呼び出し側は、このグループが関係性の端点になっていた場合の孤立除去
 * （`relationalService.removeRelationalsForAnnotation(groupId)`）を実行すること
 */
export async function ungroupAnnotations(
  file: ContainerElementFile,
  groupId: AnnotationGroupID,
): Promise<Result<void>> {
  const configRes = await loadConfig(file);
  if (!configRes.ok) return configRes;

  if (configRes.value.groups[groupId] === undefined) {
    return Failure(new NotFoundError('Annotation group not found'));
  }

  const updatedGroups = withoutGroups(configRes.value.groups, new Set([groupId]));

  const saveRes = await containerConfigService.saveDocumentConfigFile(
    file.containerID,
    file.path,
    Object.values(configRes.value.annots),
    configRes.value.fileHash,
    configRes.value.bookmarks,
    updatedGroups,
    configRes.value.outlineImported ?? false,
  );
  if (!saveRes.ok) return saveRes;

  return annotationGroupRepository.removeGroup(groupId);
}

/**
 * グループ全体を代表する値の算出方法を設定・変更する
 */
export async function updateGroupValueAggregation(
  file: ContainerElementFile,
  groupId: AnnotationGroupID,
  aggregation: GroupValueAggregation,
): Promise<Result<AnnotationGroup>> {
  const configRes = await loadConfig(file);
  if (!configRes.ok) return configRes;

  const target = configRes.value.groups[groupId];
  if (target === undefined) return Failure(new NotFoundError('Annotation group not found'));

  const updatedGroup: AnnotationGroup = {
    ...target,
    valueAggregation: aggregation,
    updatedAt: dayjs().toISOString(),
  };
  const updatedGroups = { ...configRes.value.groups, [groupId]: updatedGroup };

  const saveRes = await containerConfigService.saveDocumentConfigFile(
    file.containerID,
    file.path,
    Object.values(configRes.value.annots),
    configRes.value.fileHash,
    configRes.value.bookmarks,
    updatedGroups,
    configRes.value.outlineImported ?? false,
  );
  if (!saveRes.ok) return saveRes;

  const cacheRes = await annotationGroupRepository.upsertGroups(file, Object.values(updatedGroups));
  if (!cacheRes.ok) return cacheRes;

  return Success(updatedGroup);
}

/**
 * `.kcfg`から読み込んだグループ一覧を、グローバルキャッシュ（関係性のアドレス解決に使う）へ
 * 同期する（`annotationService.registerConfigAnnotationInfos`のグループ版）
 */
export function syncGroupCache(
  file: ContainerElementFile,
  groups: AnnotationGroup[],
): Promise<Result<void>> {
  return annotationGroupRepository.upsertGroups(file, groups);
}

/**
 * ファイルのリネーム・移動に伴い、キャッシュ済みグループ記録のfilePathを付け替える
 */
export function remapFilePath(
  containerID: ContainerID,
  oldPath: string,
  newPath: string,
): Promise<Result<void>> {
  return annotationGroupRepository.remapFilePath(containerID, oldPath, newPath);
}
