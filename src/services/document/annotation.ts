import type { ContainerElementFile } from 'src/models/container';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import type { Result } from 'src/models/error/result';
import { Success } from 'src/models/error/result';
import type { AnnotationInfo } from 'src/models/relational/fileSchema';
import * as containerService from 'src/services/container/main';
import * as annotationRepository from 'src/repositories/db/annotation';
import type { Observable } from 'dexie';
import { extractImageFromRegion } from 'src/repositories/document/pdf';
import { Image2Text } from 'src/utils/ocr/main';

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
 * コンテンツ未読み込みのアノテーションにコンテンツを読み込んで付与する
 */
async function loadAnnotContent(
  file: ContainerElementFile,
  annotationInfo: AnnotationInfo,
): Promise<Result<void>> {
  const loadImg = async () => {
    const fileSrc = await containerService.loadFileAsDocumentSource(file.containerID, file.path);
    if (!fileSrc.ok) return fileSrc;

    // TODO: 本来は文書種別をもとに処理を分岐すべき
    const img = await extractImageFromRegion(fileSrc.value, annotationInfo.style, 4);
    return img
  }

  // 画像から文字情報を読み取り
  // TODO: 処理高速化のために、事前にOCRをかけておいて、ここでは位置情報から直接テキストを取得する方が良い？
  const img = await loadImg()
  // 画像化処理が失敗した場合は空文字列を与える
  const text = img.ok ? await Image2Text(img.value) : '';
  annotationInfo.context.text = text;

  // 更新版のアノテーション情報を登録する
  const saveRes = await annotationRepository.addAnnotationInfos(file, [annotationInfo]);
  if (!saveRes.ok) return saveRes;

  return Success();
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
  const annotationInfo: AnnotationInfo = {
    style: aStyle,
    context: {
      text: undefined,
    },
  };

  // コンテンツの読み込みは投げっぱなし（失敗しても空文字列がコンテンツとして格納されるだけ）
  void loadAnnotContent(file, annotationInfo);

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
