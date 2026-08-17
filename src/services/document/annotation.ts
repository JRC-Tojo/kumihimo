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
import {
  ANNOTATION_GEOMETRY,
  duplicateAnnotation,
} from 'src/components/Viewer/Annotation/annotationGeometry';
import { computeReorderedZIndex, type LayerOrderAction } from 'src/utils/document/annotationOrder';
import { getSettings } from 'src/settings/main';

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

  const fileIdentity = { containerID: address.value.cID, path: address.value.filePath };
  return extractAnnotationContextPreview(fileIdentity, fileSrc.value, info.value.style, scale);
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
 * 特定ファイルに紐づく未保存（仮登録）のアノテーションIDを取得する
 */
export function getTemporaryAnnotationIds(
  file: ContainerElementFile,
): Promise<Result<Set<AnnotationID>>> {
  return annotationRepository.getTemporaryAnnotationIds(file);
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
  const directText = await extractTextByAnnot(file, fileSrc.value, annotationInfo.style);
  if (directText.ok && directText.value !== '') {
    annotationInfo.context.text = directText.value;
  } else {
    // 画像から文字情報を読み取り
    const img = await extractImageFromRegion(file, fileSrc.value, annotationInfo.style, 4);
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

/** アノテーションのページ番号・外接矩形が変化したかどうかを判定する（内容再読み込みの要否判定用） */
const GEOMETRY_EPSILON = 0.01;
function hasGeometryChanged(previous: AnnotationStyle | undefined, next: AnnotationStyle): boolean {
  if (!previous) return true; // 新規アノテーションは必ず読み込む
  if (previous.pageNumber !== next.pageNumber) return true;
  if (previous.type !== next.type) return true;

  const prevBox = ANNOTATION_GEOMETRY[previous.type].boundingBox(previous);
  const nextBox = ANNOTATION_GEOMETRY[next.type].boundingBox(next);
  return (
    Math.abs(prevBox.x - nextBox.x) > GEOMETRY_EPSILON ||
    Math.abs(prevBox.y - nextBox.y) > GEOMETRY_EPSILON ||
    Math.abs(prevBox.width - nextBox.width) > GEOMETRY_EPSILON ||
    Math.abs(prevBox.height - nextBox.height) > GEOMETRY_EPSILON
  );
}

/**
 * アノテーション情報を登録する
 *
 * 位置・サイズ（ページ番号込みの外接矩形）が変化した場合のみ、アノテーションされている
 * コンテンツ（テキスト抽出・OCR）を読み取り直す。色やスタイルのみの変更のたびにPDF全体の
 * 再読込・OCRを走らせるとメモリ・処理コストが大きいため、実際に内容が変わり得る場合のみに絞る
 */
export async function registerAnnotationStyle(
  file: ContainerElementFile,
  aStyle: AnnotationStyle,
): Promise<Result<AnnotationInfo>> {
  const previous = await annotationRepository.getAnnotationInfo(aStyle.id);

  // authorが未設定の場合のみ、設定済みのユーザー名で補完する（既にセット済み＝プラグイン実行側が
  // 事前に設定したものは上書きしない。これによりプラグインによるauthorのなりすましを防ぐ）
  let resolvedStyle = aStyle;
  if (aStyle.author === undefined) {
    const settingsRes = await getSettings();
    if (settingsRes.ok && settingsRes.value.userName !== undefined) {
      resolvedStyle = { ...aStyle, author: settingsRes.value.userName };
    }
  }

  const geometryChanged = hasGeometryChanged(
    previous.ok ? previous.value.style : undefined,
    resolvedStyle,
  );

  const annotationInfo: AnnotationInfo = {
    style: resolvedStyle,
    context: {
      // 位置・サイズが変わった場合は内容を読み取り直すため、再読込が完了するまでは
      // 「未読み込み」（undefined）として扱う。こうしないと、関係性検証が実際にはズレて
      // いるかもしれない古いOCR結果のまま一時的にOK/NGを表示してしまう。
      // 変わっていない場合のみ既存のOCR結果を引き継ぐ
      text: geometryChanged ? undefined : previous.ok ? previous.value.context.text : undefined,
    },
  };

  // アノテーション基本情報を保存
  const saveRes = await annotationRepository.addAnnotationInfos(file, [annotationInfo]);
  if (!saveRes.ok) return saveRes;

  if (geometryChanged) {
    // コンテンツの読み込みは投げっぱなしにするが、失敗時はcontext.textがundefinedのまま
    // DBに残り続けないよう、明示的に空文字列で確定させる
    void loadAnnotContent(file, annotationInfo).then((res) => {
      if (!res.ok)
        void annotationRepository.updateAnnotationContentText(annotationInfo.style.id, '');
    });
  }

  return Success(annotationInfo);
}

/**
 * DBにアノテーション情報を追加する
 *
 * @param isTemporary 未保存の仮登録として追加するか。`.kcfg`から読み込んだ確定済みデータを
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
 * 前後関係から新しいzIndexを算出し、`style`のみを部分更新する（`registerAnnotationStyle`は
 * 新規登録用でcontextを巻き戻してしまうため使わない。既存のOCR抽出結果はそのまま返す）
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

  const existingInfo = await getAnnotationInfo(targetId);
  if (!existingInfo.ok) return existingInfo;

  const updatedStyle: AnnotationStyle = { ...target, zIndex, updatedAt: dayjs().toISOString() };
  const saveRes = await annotationRepository.updateAnnotationStyle(updatedStyle);
  if (!saveRes.ok) return saveRes;

  return Success({ style: updatedStyle, context: existingInfo.value.context });
}

/**
 * 複数の注釈を複製し、指定したページへ貼り付ける（ペースト）
 *
 * 各`sources`要素を`duplicateAnnotation`で複製し、`offset`（呼び出し元が算出した文書座標系の
 * 移動量）だけ全要素を同じ量だけずらしながら`registerAnnotationStyle`で保存する（複数選択を
 * 一括ペーストした際の相対的な位置関係を保つため）。複製元の`zIndex`をそのまま引き継ぐと
 * 重ね順キーが衝突するため、`zIndex`はリセットしcreatedAt基準に戻す
 */
export async function pasteAnnotations(
  file: ContainerElementFile,
  sources: AnnotationStyle[],
  pageNumber: number,
  offset: { dx: number; dy: number },
): Promise<Result<AnnotationInfo[]>> {
  const results: AnnotationInfo[] = [];
  for (const source of sources) {
    const duplicated = duplicateAnnotation(
      source,
      pageNumber,
      source.x + offset.dx,
      source.y + offset.dy,
    );
    const res = await registerAnnotationStyle(file, { ...duplicated, zIndex: undefined });
    if (!res.ok) return res;
    results.push(res.value);
  }
  return Success(results);
}
