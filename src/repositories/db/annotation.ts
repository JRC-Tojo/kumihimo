/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/require-await */
import type { ContainerElementFile } from 'src/models/container';
import type { AnnotationID } from 'src/models/document/pdf';
import type { Result } from 'src/models/error/result';
import { Failure, Success } from 'src/models/error/result';
import type { AnnotationInfo } from 'src/models/relational/fileSchema';

/**
 * 読み込み中の文書におけるアノテーション一覧を格納するDBを初期化する
 */
export async function initAnnotDB(): Promise<Result<void>> {
  // TODO: Dexieを用いたDB初期化処理を実装する
  return Success();
}

/**
 * DBからアノテーション情報を取得する
 */
export async function getAnnotationInfo(annotID: AnnotationID): Promise<Result<AnnotationInfo>> {
  // TODO: Dexieからアノテーション情報を読み込む
  return Failure(new Error('annotation DB is not implemented'));
}

/**
 * アノテーション情報を仮フラグ付きで追加する
 */
export async function addAnnotationInfo(
  file: ContainerElementFile,
  aInfo: AnnotationInfo,
): Promise<Result<void>> {
  // TODO: Dexieに仮保存として追加する
  return Success();
}

/**
 * アノテーション情報を仮フラグ付きで追加する
 */
export async function addAnnotationInfos(
  file: ContainerElementFile,
  aInfos: AnnotationInfo[],
): Promise<Result<void>> {
  // TODO: Dexieに複数件を仮保存として追加する
  return Success();
}

/**
 * 特定のファイルのアノテーション情報をDBから取得する
 */
export async function getAnnotationsByFile(
  file: ContainerElementFile,
): Promise<Result<AnnotationInfo[]>> {
  // TODO: file.containerID / file.path で絞り込みを行う
  return Success([]);
}

/**
 * DBに格納されている特定ファイルのアノテーションを保存する（＝仮フラグを撤去する）
 */
export async function commitAnnotations(
  file?: ContainerElementFile,
): Promise<Result<AnnotationInfo[]>> {
  // TODO: 仮フラグを本保存フラグに変更し、対象のAnnotationInfo一覧を返す
  return Success([]);
}

/**
 * 指定したアノテーションを仮フラグ付きで削除する
 */
export async function softRemoveAnnotation(annotID: AnnotationID): Promise<Result<void>> {
  // TODO: 仮削除フラグを立てる
  return Success();
}
