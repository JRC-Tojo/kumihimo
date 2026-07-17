import dayjs from 'dayjs';
import type { ContainerElementFile, ContainerID } from 'src/models/container';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import type { Result } from 'src/models/error/result';
import { Success, Failure } from 'src/models/error/result';
import type { AnnotationBaseAddress, AnnotationInfo } from 'src/models/relational/fileSchema';
import * as containerService from 'src/services/container/main';
import * as annotationRepository from 'src/repositories/db/annotation';
import type { Observable } from 'dexie';
import {
  extractImageFromRegion,
  extractAnnotationContextPreview,
  extractTextByAnnot,
} from 'src/repositories/document/pdf';
import { Image2Text } from 'src/utils/ocr/main';
import { duplicateAnnotation } from 'src/services/document/annotationGeometry';
import { computeReorderedZIndex, type LayerOrderAction } from 'src/utils/document/annotationOrder';

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
 * DBからアノテーションの保存パスを取得する
 */
export function getAnnotationAddress(
  annotID: AnnotationID,
): Promise<Result<AnnotationBaseAddress>> {
  return annotationRepository.getAnnotationAddress(annotID);
}

/**
 * アノテーションIDから、その周辺の文脈も確認できるプレビュー画像（PNG dataURL）を取得する
 *
 * アノテーション自体の領域のみではなく、そのページの周辺領域も含めて描画し、
 * アノテーション位置には強調枠を付与する
 */
export async function getAnnotationPreviewImage(
  annotID: AnnotationID,
  scale = 2,
): Promise<Result<string>> {
  const info = await getAnnotationInfo(annotID);
  if (!info.ok) return info;
  const address = await getAnnotationAddress(annotID);
  if (!address.ok) return address;

  const fileSrc = await containerService.loadFileAsDocumentSource(
    address.value.cID,
    address.value.filePath,
  );
  if (!fileSrc.ok) return fileSrc;

  return extractAnnotationContextPreview(fileSrc.value, info.value.style, scale);
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
 * 特定ファイルに紐づく未保存（仮登録）のアノテーション件数を取得する
 */
export function countTemporaryAnnotations(file: ContainerElementFile): Promise<Result<number>> {
  return annotationRepository.countTemporaryAnnotations(file);
}

/**
 * コンテンツ未読み込みのアノテーションにコンテンツを読み込んで付与する
 * TODO: 本来は文書種別をもとに処理を分岐すべき
 */
async function loadAnnotContent(
  file: ContainerElementFile,
  annotationInfo: AnnotationInfo,
): Promise<Result<void>> {
  const fileSrc = await containerService.loadFileAsDocumentSource(file.containerID, file.path);
  if (!fileSrc.ok) return fileSrc;

  // PDFにテキスト情報がすでに含まれている場合はその情報を取得
  const directText = await extractTextByAnnot(fileSrc.value, annotationInfo.style);
  if (directText.ok && directText.value !== '') {
    annotationInfo.context.text = directText.value;
  } else {
    // 画像から文字情報を読み取り
    const img = await extractImageFromRegion(fileSrc.value, annotationInfo.style, 4);
    // 画像化・OCR処理が失敗した場合は空文字列を与える
    const text = img.ok ? await Image2Text(img.value).catch(() => '') : '';
    annotationInfo.context.text = text;
  }

  // 抽出したテキストのみをDBへ反映する。
  // OCR完了まで時間がかかるため、ここで`annotationInfo`（呼び出し時点のstyleを保持したまま）を
  // まるごと書き戻すと、処理中に行われた頂点ドラッグ等の編集結果を古いstyleで上書きしてしまう
  const saveRes = await annotationRepository.updateAnnotationContentText(
    annotationInfo.style.id,
    annotationInfo.context.text ?? '',
  );
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

  // アノテーション基本情報を保存
  const saveRes = await annotationRepository.addAnnotationInfos(file, [annotationInfo]);
  if (!saveRes.ok) return saveRes;

  // コンテンツの読み込みは投げっぱなし（失敗しても空文字列がコンテンツとして格納されるだけ）
  void loadAnnotContent(file, annotationInfo);

  return Success(annotationInfo);
}

/**
 * DBにアノテーション情報を追加する
 *
 * @param isTemporary 未保存の仮登録として追加するか。`.rdcfg`から読み込んだ確定済みデータを
 * 反映する場合は`false`を指定すること
 */
export function registerAnnotationInfo(
  aInfo: AnnotationInfo[],
  file: ContainerElementFile,
  isTemporary: boolean,
): Promise<Result<void>> {
  return annotationRepository.addAnnotationInfos(file, aInfo, isTemporary);
}

/**
 * 特定ファイルのアノテーションDBレコードをすべて削除する（未保存破棄時の再構築用）
 */
export function clearAnnotationsForFile(file: ContainerElementFile): Promise<Result<void>> {
  return annotationRepository.deleteAnnotationsForFile(file);
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

/**
 * ファイルのリネーム・移動に伴い、読み込み中のアノテーション記録のfilePathを付け替える
 */
export function remapFilePath(
  containerID: ContainerID,
  oldPath: string,
  newPath: string,
): Promise<Result<void>> {
  return annotationRepository.remapFilePath(containerID, oldPath, newPath);
}

/**
 * 指定した注釈の重ね順（zIndex）を変更する
 *
 * `annotations`には対象と同じページ（同じファイル）の注釈一覧を渡す。ソートキー順の
 * 前後関係から新しいzIndexを算出し、`registerAnnotationStyle`で保存する
 */
export async function reorderAnnotationStyle(
  file: ContainerElementFile,
  annotations: AnnotationStyle[],
  targetId: AnnotationID,
  action: LayerOrderAction,
): Promise<Result<AnnotationInfo>> {
  const target = annotations.find((a) => a.id === targetId);
  if (!target) return Failure(new Error('対象のアノテーションが見つかりません'));

  const zIndex = computeReorderedZIndex(annotations, targetId, action);
  if (zIndex === null) return Failure(new Error('重ね順の算出に失敗しました'));

  return registerAnnotationStyle(file, { ...target, zIndex, updatedAt: dayjs().toISOString() });
}

/**
 * 複数の注釈を複製し、指定したページへ貼り付ける（ペースト）
 *
 * 各`sources`要素を`duplicateAnnotation`で複製し、貼り付け位置が重ならないよう
 * `offsetStep`ずつ位置をずらしながら`registerAnnotationStyle`で保存する
 */
export async function pasteAnnotations(
  file: ContainerElementFile,
  sources: AnnotationStyle[],
  pageNumber: number,
  offsetStep: number,
): Promise<Result<AnnotationInfo[]>> {
  const results: AnnotationInfo[] = [];
  for (const source of sources) {
    const duplicated = duplicateAnnotation(
      source,
      pageNumber,
      source.x + offsetStep,
      source.y + offsetStep,
    );
    const res = await registerAnnotationStyle(file, duplicated);
    if (!res.ok) return res;
    results.push(res.value);
  }
  return Success(results);
}
