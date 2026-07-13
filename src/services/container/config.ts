/**
 * コンテナルートに保存する本システムの関連ファイルに関する処理を記述する
 */

import type { DocumentSource } from 'src/models/document/common';
import { Path } from 'src/utils/binary/path';
import type { ContainerElementFile, ContainerID } from 'src/models/container';
import { Success, type Result } from 'src/models/error/result';
import { calcBase64Hash } from 'src/utils/binary/base64';
import type {
  AnnotationBaseAddress,
  AnnotationInfo,
  RelationalInFile,
} from 'src/models/relational/fileSchema';
import { CachedRelationalFile, DocumentConfigFile } from 'src/models/relational/fileSchema';
import * as textRepository from 'src/repositories/document/text';
import type { RelationalWithAddress } from 'src/models/relational/common';
import { CONFIG_FILE_EXTS } from 'src/models/document/common';
import { fromEntries } from 'src/utils/obj/obj';
import type { AnnotationID } from 'src/models/document/pdf';

const CONTAINER_CONFIG_FOLDER = '.rd';

/**
 * 文書設定ファイルのパスを取得する
 */
export function getConfigPath(filePath: string): string {
  const pathObj = new Path(filePath);
  const parentPath = pathObj.parent();
  const pathName = pathObj.basename();
  const configPath = parentPath.child(pathName + CONFIG_FILE_EXTS);
  return configPath.path;
}

/**
 * 関係性情報を記録しているコンテナルートのファイルパス
 */
function getRelationalFilePath(cPath: string): string {
  const path = new Path(cPath).child(CONTAINER_CONFIG_FOLDER).child('relational.json');
  return path.path;
}

/**
 * 各文書のバックアップファイルのパスを取得する
 *
 * バックアップは文書メタ情報保存時に同時に実行されるものとする
 */
function getBackupFilePath(cPath: string, fileHash: string): string {
  const targetPath = new Path(cPath)
    .child(CONTAINER_CONFIG_FOLDER)
    .child('backups', `${fileHash}.bak`);
  return targetPath.path;
}

/**
 * 関係性ファイルがまだ作成されていない場合（コンテナの初回読み込み時等）の初期値
 */
const EMPTY_CACHED_RELATIONAL_FILE: CachedRelationalFile = {
  annotIdToFileInfo: {},
  relationals: [],
};

/**
 * コンテナルートに保存されている関係性ファイルを取得
 *
 * ファイルがまだ存在しない場合（コンテナの初回読み込み時等）は空の状態として扱う。
 * 実データの読み込み自体に失敗した場合のみこれを空扱いとし、
 * 読み込めた内容のデコード・検証に失敗した場合は本来のエラーとして返す
 */
export async function getRelationalFile(cID: ContainerID): Promise<Result<CachedRelationalFile>> {
  const containerService = await import('./main');
  const container = containerService.getContainer(cID);
  if (!container.ok) return container;

  // 関係性ファイルの本体データを取得
  const relationalFilePath = getRelationalFilePath(container.value.containerPath);
  const src = await containerService.loadFileAsDocumentSource(cID, relationalFilePath);
  if (!src.ok) return Success(EMPTY_CACHED_RELATIONAL_FILE);

  // 取得したデータをデコードする
  const fileContent = textRepository.loadTextContents(src.value, CachedRelationalFile);

  return fileContent;
}

/**
 * 関係性をファイル保存用スキーマへ変換する
 *
 * @param oldFile 関係性更新前である現状の関係性保存ファイルの中身
 * @param updateDocPath 関係性保存ファイルのうち、ここで指定したファイルを起点とする関係性のみを更新する
 * @param rs 今回の更新で反映したい関係性一覧
 * @returns `updateDocPath`で指定したファイルに関連する関係性を更新した保存ファイルの中身を返す
 */
export function buildCachedRelationalFile(
  oldFile: CachedRelationalFile,
  updateDocPath: string,
  rsWithAdrs: RelationalWithAddress[],
): CachedRelationalFile {
  // 1. 更新対象ファイルに関わる既存の関係性を破棄する
  const isUpdatedDocumentRelation = (relation: RelationalInFile): boolean => {
    const srcInfo = oldFile.annotIdToFileInfo[relation.src];
    if (srcInfo?.filePath === updateDocPath) return true;

    const targetInfo = oldFile.annotIdToFileInfo[relation.target];
    if (targetInfo?.filePath === updateDocPath) return true;

    return false;
  };

  const preservedRelationals = oldFile.relationals.filter(
    (relation) => !isUpdatedDocumentRelation(relation),
  );

  // 2. 実行中のRelational[]を更新対象ファイルに関わるものだけに絞り、
  //    ファイル保存用の簡易ルール形式に変換する
  const filteredRs = rsWithAdrs.filter((relation) => {
    const srcPath = relation.srcAddress.filePath;
    const targetPath = relation.targetAddress.filePath;
    return srcPath === updateDocPath || targetPath === updateDocPath;
  });

  const convertedRelationals = filteredRs.map((relation) => ({
    src: relation.relational.srcID,
    target: relation.relational.targetID,
    rule: relation.relational.rule,
  }));

  // 3. 既存と新規を統合し、キー重複を排除する
  const allRelationals = [...preservedRelationals, ...convertedRelationals];
  const uniqueRelationals = Array.from(
    allRelationals.reduce((map, relation) => {
      const relationKey = `${relation.src}:${relation.target}:${JSON.stringify(relation.rule)}`;
      if (!map.has(relationKey)) {
        map.set(relationKey, relation);
      }
      return map;
    }, new Map<string, RelationalInFile>()),
  ).map(([, relation]) => relation);

  // 4. 保存時に必要なAnnotationIDのファイル情報を再構築する
  const referencedAnnotIDs = new Set<AnnotationID>();
  uniqueRelationals.forEach((relation) => {
    referencedAnnotIDs.add(relation.src);
    referencedAnnotIDs.add(relation.target);
  });

  const annotIdToFileInfo: Record<AnnotationID, AnnotationBaseAddress> = {};

  // 4a. まず新規Relationalから優先的にファイル情報を埋める
  const assignFromRelation = (relation: RelationalWithAddress) => {
    annotIdToFileInfo[relation.relational.srcID] = relation.srcAddress;
    annotIdToFileInfo[relation.relational.targetID] = relation.targetAddress;
  };
  filteredRs.forEach(assignFromRelation);

  // 4b. 残ったAnnotationIDは旧ファイルから補完する
  referencedAnnotIDs.forEach((annotID) => {
    if (annotIdToFileInfo[annotID] !== undefined) return;
    const oldFileInfo = oldFile.annotIdToFileInfo[annotID];
    if (oldFileInfo !== undefined) {
      annotIdToFileInfo[annotID] = oldFileInfo;
    }
  });

  return {
    annotIdToFileInfo,
    relationals: uniqueRelationals,
  };
}

/**
 * 関係性ファイルを更新する
 *
 * - @param updateFilePath 関係性を保存するに際して更新対象となった文書ファイルのパス
 */
export async function updateRelationalFile(
  cID: ContainerID,
  updateDocPath: string,
  rsWithAdrs: RelationalWithAddress[],
): Promise<Result<void>> {
  const containerService = await import('./main');

  // 1. 対象コンテナの取得
  const container = containerService.getContainer(cID);
  if (!container.ok) return container;

  // 2. 既存のキャッシュ関係性ファイルを読み込む
  const oldRelationalFile = await getRelationalFile(cID);
  if (!oldRelationalFile.ok) return oldRelationalFile;

  // 3. 更新要求に基づき、保存用のCachedRelationalFileを構築する
  const convertedRelational = buildCachedRelationalFile(
    oldRelationalFile.value,
    updateDocPath,
    rsWithAdrs,
  );

  // 4. JSON化して保存形式に変換する
  const relFileStr = JSON.stringify(convertedRelational, null, 2);
  const relFileSrc = textRepository.encodeTextContents(relFileStr);
  if (!relFileSrc.ok) return relFileSrc;

  // 5. コンテナルートの関係性ファイルを更新する
  const relationalFilePath = getRelationalFilePath(container.value.containerPath);
  const createRes = await containerService.createFile(cID, relationalFilePath, relFileSrc.value);
  if (!createRes.ok) return createRes;

  return Success();
}

/**
 * `CachedRelationalFile`内の`annotIdToFileInfo[...].filePath`を、旧パス→新パスのマップに従って付け替える
 *
 * ファイルのリネーム・移動に伴う副作用伝播のための純粋関数（テストしやすいよう分離している）
 */
export function remapCachedRelationalFilePaths(
  oldFile: CachedRelationalFile,
  pathMap: Record<string, string>,
): CachedRelationalFile {
  const remappedAnnotIdToFileInfo: Record<AnnotationID, AnnotationBaseAddress> = {};
  for (const [annotID, address] of Object.entries(oldFile.annotIdToFileInfo)) {
    const newFilePath = pathMap[address.filePath];
    remappedAnnotIdToFileInfo[annotID as AnnotationID] =
      newFilePath !== undefined ? { ...address, filePath: newFilePath } : address;
  }

  return {
    annotIdToFileInfo: remappedAnnotIdToFileInfo,
    relationals: oldFile.relationals,
  };
}

/**
 * ファイルのリネーム・移動に伴い、コンテナルートの関係性キャッシュファイル内の
 * `annotIdToFileInfo[...].filePath`を一括で付け替える
 *
 * @param pathMap 旧パス→新パスのマップ（リネーム対象になったFile要素の分のみ）
 */
export async function remapRelationalFilePaths(
  cID: ContainerID,
  pathMap: Record<string, string>,
): Promise<Result<void>> {
  const containerService = await import('./main');

  const oldRelationalFile = await getRelationalFile(cID);
  if (!oldRelationalFile.ok) return oldRelationalFile;

  const updatedFile = remapCachedRelationalFilePaths(oldRelationalFile.value, pathMap);

  const relFileStr = JSON.stringify(updatedFile, null, 2);
  const relFileSrc = textRepository.encodeTextContents(relFileStr);
  if (!relFileSrc.ok) return relFileSrc;

  const container = containerService.getContainer(cID);
  if (!container.ok) return container;
  const relationalFilePath = getRelationalFilePath(container.value.containerPath);
  const createRes = await containerService.createFile(cID, relationalFilePath, relFileSrc.value);
  if (!createRes.ok) return createRes;

  return Success();
}

/**
 * 文書設定ファイルを取得する
 */
export async function getDocumentConfigFile(
  cID: ContainerID,
  configPath: string,
): Promise<Result<DocumentConfigFile>>;
export async function getDocumentConfigFile(
  cID: ContainerID,
  file: ContainerElementFile,
): Promise<Result<DocumentConfigFile>>;
export async function getDocumentConfigFile(
  cID: ContainerID,
  filePath: ContainerElementFile | string,
): Promise<Result<DocumentConfigFile>> {
  const containerService = await import('./main');
  const targetPath = typeof filePath === 'string' ? filePath : getConfigPath(filePath.path);
  const configSrc = await containerService.loadFileAsDocumentSource(cID, targetPath);
  if (!configSrc.ok) return configSrc;

  const parsedConfig = textRepository.loadTextContents(configSrc.value, DocumentConfigFile);
  return parsedConfig;
}

/**
 * 文書設定ファイルを保存する
 */
export async function saveDocumentConfigFile(
  cID: ContainerID,
  filePath: string,
  annotInfos: AnnotationInfo[],
  fileHash: string,
): Promise<Result<void>> {
  // 書き込む情報を構築する
  const docConf: DocumentConfigFile = {
    fileHash,
    annots: fromEntries(annotInfos.map((aInfo) => [aInfo.style.id, aInfo])),
  };
  const docConfStr = JSON.stringify(docConf, null, 2);
  const docConfSrc = textRepository.encodeTextContents(docConfStr);
  if (!docConfSrc.ok) return docConfSrc;

  // ファイルにデータを保存
  const containerService = await import('./main');
  const configFilePath = getConfigPath(filePath);
  const createRes = await containerService.createFile(cID, configFilePath, docConfSrc.value);
  if (!createRes.ok) return createRes;

  return Success();
}

/**
 * バックアップファイルの本体データを取得する
 */
export async function getBackupSrc(
  cID: ContainerID,
  fileHash: string,
): Promise<Result<DocumentSource>> {
  const containerService = await import('./main');

  const container = containerService.getContainer(cID);
  if (!container.ok) return container;

  const targetPath = getBackupFilePath(container.value.containerPath, fileHash);
  const fileSrc = await containerService.loadFileAsDocumentSource(cID, targetPath);
  return fileSrc;
}

/**
 * バックアップファイルを保存する
 */
export async function saveBackupSrc(
  cID: ContainerID,
  src: DocumentSource,
  newFileHash: string,
): Promise<Result<void>> {
  const containerService = await import('./main');

  const container = containerService.getContainer(cID);
  if (!container.ok) return container;

  const targetPath = getBackupFilePath(container.value.containerPath, newFileHash);
  const createRes = await containerService.createFile(cID, targetPath, src);
  if (!createRes.ok) return createRes;

  return Success();
}

/**
 * 特定の文書のメタ情報に関する保存処理を実行する
 *
 * - 本体データのバックアップを作成
 * - 文書設定ファイルの更新
 */
export async function saveDocumentConfigs(
  cID: ContainerID,
  filePath: string,
  oldSrc: DocumentSource,
  newSrc: DocumentSource,
  annotInfos: AnnotationInfo[],
): Promise<Result<void>> {
  // 新ファイルのハッシュ値を取得
  const newSrcHash = await calcBase64Hash(newSrc);
  if (!newSrcHash.ok) return newSrcHash;

  // バックアップファイルを作成
  const backupRes = await saveBackupSrc(cID, oldSrc, newSrcHash.value);
  if (!backupRes.ok) return backupRes;

  // 文書設定ファイルの更新
  const docConfRes = await saveDocumentConfigFile(cID, filePath, annotInfos, newSrcHash.value);
  if (!docConfRes.ok) return docConfRes;

  return Success();
}
