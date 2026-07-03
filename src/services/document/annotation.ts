import type { ContainerElementFile } from 'src/models/container';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import type { Result } from 'src/models/error/result';
import type { AnnotationInfo } from 'src/models/relational/fileSchema';
import * as containerService from 'src/services/container/main';

/**
 * 読み込み中の文書におけるアノテーション一覧を格納するDBを初期化する
 */
export async function initAnnotDB(): Promise<Result<void>> {}

/**
 * DBからアノテーション情報を取得する
 */
export async function getAnnotationInfo(annotID: AnnotationID): Promise<Result<AnnotationInfo>> {
  // TODO: DBから取得する処理を実装
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
  // Style情報を基に実ファイルからコンテンツを抽出する
  const fileSrc = await containerService.loadFileAsDocumentSource(file.containerID, file.path)
  // 抽出した情報をDBに登録する
  // TODO: 取得した情報を成形して返す
}

/**
 * DBにアノテーション情報を仮フラグ付きで追加する
 */
export async function registerAnnotationInfo(
  aInfo: AnnotationInfo[],
  file: ContainerElementFile,
): Promise<Result<void>> {
  // TODO: DBに追加する処理を実装
}

/**
 * DBに格納されている特定ファイルのアノテーションを保存する（＝仮フラグを撤去する）
 *
 * 保存したアノテーション一覧を返す
 */
export async function saveAnnotaionInfo(): Promise<Result<AnnotationInfo[]>> {}
