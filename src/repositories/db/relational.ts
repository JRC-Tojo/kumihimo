/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/require-await */
import type { ContainerElementFile, ContainerID } from 'src/models/container';
import type { Result } from 'src/models/error/result';
import { Success } from 'src/models/error/result';
import type { Relational } from 'src/models/relational/common';

/**
 * 読み込み中の関係性情報をすべて管理するDBを初期化する
 */
export async function initRelationalDB(): Promise<Result<void>> {
  // TODO: Dexieを用いたDB初期化処理を実装する
  return Success();
}

/**
 * キャッシュから読み込んだ関係性情報をDBに登録する
 */
export async function addCachedRelationals(
  cID: ContainerID,
  relationals: Relational[],
): Promise<Result<void>> {
  // TODO: Dexieにキャッシュされた関係性情報を登録する
  return Success();
}

/**
 * 特定のファイルをsource側とするRelational一覧をDBから取得して返す
 */
export async function getRelationalsByFile(
  file: ContainerElementFile,
): Promise<Result<Relational[]>> {
  // TODO: file.containerID / file.path をもとに絞り込みを行う
  return Success([]);
}

/**
 * 関係性を仮フラグつきで新規登録する
 */
export async function addRelational(relational: Relational): Promise<Result<void>> {
  // TODO: Dexieに仮保存として登録する
  return Success();
}

/**
 * 指定したアノテーションIDに紐づく関係性を仮削除としてマークする
 */
export async function softRemoveRelationalsBySrcID(srcID: string): Promise<Result<void>> {
  // TODO: Dexie上の関連情報に削除フラグを付与する
  return Success();
}

/**
 * 特定ファイルの関係性を本保存し、保存済みの一覧を返す
 */
export async function commitRelationals(file: ContainerElementFile): Promise<Result<Relational[]>> {
  // TODO: 対象ファイルの仮フラグを撤去し、本保存済みのRelationalを返却する
  return Success([]);
}
