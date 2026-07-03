/**
 * コンテナルートに保存する本システムの関連ファイルに関する処理を記述する
 */

import type { DocumentSource } from 'src/models/document/common';
import { Path } from 'src/utils/binary/path';
import * as containerService from './main';
import type { ContainerElementFile, ContainerID } from 'src/models/container';
import { Success, type Result } from 'src/models/error/result';
import { calcBase64Hash } from 'src/utils/binary/base64';
import type { AnnotationInfo } from 'src/models/relational/fileSchema';
import { CachedRelationalFile, DocumentConfigFile } from 'src/models/relational/fileSchema';
import * as textRepository from 'src/repositories/document/text';
import type { Relational } from 'src/models/relational/common';
import { CONFIG_FILE_EXTS } from 'src/models/document/common';
import { fromEntries } from 'src/utils/obj/obj';

const CONTAINER_CONFIG_FOLDER = '.rd';

/**
 * 文書設定ファイルのパスを取得する
 */
function getConfigPath(filePath: string): string {
  const pathExt = new Path(filePath).extname();
  const configPath = filePath.slice(0, -pathExt.length) + CONFIG_FILE_EXTS;
  return configPath;
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
 * コンテナルートに保存されている関係性ファイルを取得
 */
export async function getRelationalFile(cID: ContainerID): Promise<Result<CachedRelationalFile>> {
  const container = containerService.getContainer(cID);
  if (!container.ok) return container;

  // 関係性ファイルの本体データを取得
  const relationalFilePath = getRelationalFilePath(container.value.containerPath);
  const src = await containerService.loadFileAsDocumentSource(cID, relationalFilePath);
  if (!src.ok) return src;

  // 取得したデータをデコードする
  const fileContent = await textRepository.loadTextContents(src.value, CachedRelationalFile);

  return fileContent;
}

/**
 * 関係性ファイルを更新する
 *
 * - @param updateFilePath 関係性を保存するに際して更新対象となった文書ファイルのパス
 */
export async function updateRelationalFile(
  cID: ContainerID,
  updateDocPath: string,
  rs: Relational[],
): Promise<Result<void>> {
  const container = containerService.getContainer(cID);
  if (!container.ok) return container;

  // TODO: 現在のRelationalFileを取得して、`updateDocPath`がsrc側の項目をすべて`rs`に置換する
  // （CachedRelationalFileのうち、参照のなくなったannotは削除し、不足しているannotは追加する）
  const oldRelationalFile = await getRelationalFile(cID);
  if (!oldRelationalFile.ok) return oldRelationalFile;

  // ...

  const relFileStr = JSON.stringify(convertedRelational, null, 2);
  const relFileSrc = await textRepository.encodeTextContents(relFileStr);
  if (!relFileSrc.ok) return relFileSrc;

  // ファイルにデータを保存
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
  const targetPath = typeof filePath === 'string' ? filePath : getConfigPath(filePath.path);
  const configSrc = await containerService.loadFileAsDocumentSource(cID, targetPath);
  if (!configSrc.ok) return configSrc;

  const parsedConfig = await textRepository.loadTextContents(configSrc.value, DocumentConfigFile);
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
  const docConfSrc = await textRepository.encodeTextContents(docConfStr);
  if (!docConfSrc.ok) return docConfSrc;

  // ファイルにデータを保存
  const relationalFilePath = getConfigPath(filePath);
  const createRes = await containerService.createFile(cID, relationalFilePath, docConfSrc.value);
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

  // バックアップファイルを作成
  const backupRes = await saveBackupSrc(cID, oldSrc, newSrcHash);
  if (!backupRes.ok) return backupRes;

  // 文書設定ファイルの更新
  const docConfRes = await saveDocumentConfigFile(cID, filePath, annotInfos, newSrcHash);
  if (!docConfRes.ok) return docConfRes;

  return Success();
}
