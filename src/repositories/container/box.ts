/* eslint-disable @typescript-eslint/no-unused-vars */
import type {
  ContainerElement,
  ContainerElementFile,
  ContainerID,
  ContainerSkel,
} from 'src/models/container';
import { type Container } from 'src/models/container';
import type { DocumentSource } from 'src/models/document/common';
import type { Result } from 'src/models/error/result';
import { Failure, Success } from 'src/models/error/result';

/**
 * Boxに保存されたコンテナを取得する
 */
export async function getContainers(): Promise<Result<ContainerSkel[]>> {
  return new Promise((resolve) => resolve(Success([])));
}

/**
 * Boxに保存されたコンテナを削除する
 */
export async function deleteContainer(c: ContainerSkel): Promise<Result<void>> {
  return new Promise((resolve) => resolve(Failure(new Error('Not implemented'))));
}

/**
 * Boxにデータを保存する
 */
export async function saveContainer(c: ContainerSkel): Promise<Result<void>> {
  return new Promise((resolve) => resolve(Failure(new Error('Not implemented'))));
}

/**
 * Boxに保存されたコンテナの要素情報を取得する
 */
export async function loadContainerElements(c: ContainerSkel): Promise<Result<Container>> {
  const newContainer: Container = { ...c, elements: {} };
  return new Promise((resolve) => resolve(Success(newContainer)));
}

/**
 * Boxにファイルの実態を追加する
 */
export async function createFile(
  c: Container,
  filePath: string,
  srcData: DocumentSource,
): Promise<Result<void>> {
  return new Promise((resolve) => resolve(Failure(new Error('Not implemented'))));
}

/**
 * Boxからファイルの実態を削除する
 */
export async function deleteFile(c: Container, element: ContainerElement): Promise<Result<void>> {
  return new Promise((resolve) => resolve(Failure(new Error('Not implemented'))));
}

/**
 * Boxにファイルの実態を読み込む
 */
export async function loadSrcData(cId: ContainerID, path: string): Promise<Result<DocumentSource>> {
  return new Promise((resolve) => resolve(Failure(new Error('Not implemented'))));
}

/**
 * Boxにフォルダの実態を追加する
 */
export async function createFolder(c: Container, folderPath: string): Promise<Result<void>> {
  return new Promise((resolve) => resolve(Failure(new Error('Not implemented'))));
}

/**
 * Boxからフォルダの実態を削除する
 */
export async function deleteFolder(c: Container, folderPath: string): Promise<Result<void>> {
  return new Promise((resolve) => resolve(Failure(new Error('Not implemented'))));
}

/**
 * Boxのファイル・フォルダのパスを付け替える
 */
export async function renameEntry(
  c: Container,
  oldPath: string,
  newPath: string,
  isFolder: boolean,
): Promise<Result<void>> {
  return new Promise((resolve) => resolve(Failure(new Error('Not implemented'))));
}
