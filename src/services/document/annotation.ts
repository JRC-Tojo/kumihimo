import type { ContainerElementFile } from 'src/models/container';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import type { Result } from 'src/models/error/result';
import { Success } from 'src/models/error/result';
import type { AnnotationInfo } from 'src/models/relational/fileSchema';
import * as containerService from 'src/services/container/main';
import * as annotationRepository from 'src/repositories/db/annotation';
import type { Observable } from 'dexie';

/**
 * 読み込み中の文書におけるアノテーション一覧を格納するDBを初期化する
 */
export function initAnnotDB(): Promise<Result<void>> {
  return annotationRepository.initAnnotDB();
}

/**
 * DBからアノテーション情報を取得する
 */
export function getAnnotationInfo(annotID: AnnotationID): Promise<Result<AnnotationInfo>> {
  return annotationRepository.getAnnotationInfo(annotID);
}

/**
 * 特定のファイルに紐づくアノテーション情報を取得する
 */
export function getAnnotationsByFile(
  file: ContainerElementFile,
): Promise<Result<AnnotationInfo[]>> {
  return annotationRepository.getAnnotationsByFile(file);
}

/**
 * DexieのLiveQueryを利用して特定ファイルのアノテーション情報を購読する
 */
export function observedAnnotationStylesByFile(
  file: ContainerElementFile,
): Observable<AnnotationStyle[]> {
  return annotationRepository.observedAnnotationStylesByFile(file);
}

/**
 * アノテーション情報を登録する
 *
 * アノテーション位置やサイズの情報からアノテーションされているコンテンツを読み取る
 */
export async function registerAnnotationStyle(
  file: ContainerElementFile,
  aStyle: AnnotationStyle,
): Promise<Result<AnnotationInfo>> {
  const fileSrc = await containerService.loadFileAsDocumentSource(file.containerID, file.path);
  if (!fileSrc.ok) return fileSrc;

  // TODO: 内容の読み取り処理を追加
  const annotationInfo: AnnotationInfo = {
    style: aStyle,
    context: {
      text: '',
    },
  };

  const saveRes = await annotationRepository.addAnnotationInfos(file, [annotationInfo]);
  if (!saveRes.ok) return saveRes;

  return Success(annotationInfo);
}

/**
 * DBにアノテーション情報を仮フラグ付きで追加する
 */
export function registerAnnotationInfo(
  aInfo: AnnotationInfo[],
  file: ContainerElementFile,
): Promise<Result<void>> {
  return annotationRepository.addAnnotationInfos(file, aInfo);
}

/**
 * DBに格納されている特定ファイルのアノテーションを保存する（＝仮フラグを撤去する）
 *
 * 保存したアノテーション一覧を返す
 */
export function saveAnnotationInfo(file?: ContainerElementFile): Promise<Result<AnnotationInfo[]>> {
  return annotationRepository.commitAnnotations(file);
}

/**
 * 指定したアノテーションを仮フラグ付きで削除する
 */
export function removeAnnotationInfo(annotID: AnnotationID): Promise<Result<void>> {
  return annotationRepository.softRemoveAnnotation(annotID);
}
