/* eslint-disable @typescript-eslint/no-unused-vars */
import type { ContainerElement, ContainerElementFile, ContainerID, ContainerSkel } from 'src/models/container';
import { type Container } from 'src/models/container';
import type { DocumentSource } from 'src/models/document/common';
import type { Result } from 'src/models/error/result';
import { Failure, Success } from 'src/models/error/result';

/**
 * ローカルに保存されたコンテナを取得する
 */
export async function getContainers(): Promise<Result<ContainerSkel[]>> {
  return new Promise((resolve) => resolve(Success([])));
}

/**
 * ローカルに保存されたコンテナを削除する
 */
export async function deleteContainer(c: ContainerSkel): Promise<Result<void>> {
  return new Promise((resolve) => resolve(Failure(new Error('Not implemented'))));
}

/**
 * ローカルにデータを保存する
 */
export async function saveContainer(c: ContainerSkel): Promise<Result<void>> {
  return new Promise((resolve) => resolve(Failure(new Error('Not implemented'))));
}

/**
 * ローカルに保存されたコンテナの要素情報を取得する
 */
export async function loadContainerElements(c: ContainerSkel): Promise<Result<Container>> {
  const newContainer: Container = { ...c, elements: {} };
  return new Promise((resolve) => resolve(Success(newContainer)));
}

/**
 * ローカルにファイルの実態を追加する
 */
export async function createFile(
  c: Container,
  filePath: string,
  srcData: DocumentSource,
): Promise<Result<void>> {
  return new Promise((resolve) => resolve(Failure(new Error('Not implemented'))));
}

/**
 * ローカルからファイルの実態を削除する
 */
export async function deleteFile(c: Container, element: ContainerElement): Promise<Result<void>> {
  return new Promise((resolve) => resolve(Failure(new Error('Not implemented'))));
}

/**
 * ローカルにファイルの実態を読み込む
 */
export async function loadSrcData(cId: ContainerID, path: string): Promise<Result<DocumentSource>> {
  return new Promise((resolve) => resolve(Failure(new Error('Not implemented'))));
}
