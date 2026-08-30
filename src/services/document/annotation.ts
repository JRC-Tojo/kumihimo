import dayjs from 'dayjs';
import type { ContainerElementFile, ContainerID } from 'src/models/container';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import type { Result } from 'src/models/error/result';
import { Success, Failure } from 'src/models/error/result';
import type { AnnotationBaseAddress, AnnotationInfo } from 'src/models/relational/fileSchema';
import * as containerService from 'src/services/container/main';
import * as annotationRepository from 'src/repositories/db/annotation';
import type { Observable } from 'dexie';
import { extractImageFromRegion, extractTextByAnnot } from 'src/repositories/document/pdf';
import { Image2Text } from 'src/utils/ocr/main';
import {
  ANNOTATION_GEOMETRY,
  duplicateAnnotation,
} from 'src/components/Viewer/Annotation/annotationGeometry';
import { computeReorderedZIndex, type LayerOrderAction } from 'src/utils/document/annotationOrder';
import { getSettings } from 'src/settings/main';
import { createKeyedMutex } from 'src/utils/promise/keyedMutex';
import { fileKey } from 'src/utils/document/fileKey';

/**
 * アノテーションDBへの読み込み→計算→書き込みをファイル単位で直列化するミューテックス
 *
 * UIから高速に連続して発生する登録・削除・並べ替え（矢印キーの微調整連打、スライダー操作、
 * ドラッグ確定の連続実行等）は、いずれも「既存レコードを読む→内容を計算する→書き込む」という
 * 非同期処理になっている。これを直列化せずに複数同時実行させると、後から発生した呼び出しの
 * 読み込みが先に完了した場合、その書き込みトランザクションが先発の呼び出しより先に実行され、
 * 結果として後から書き込まれる先発（＝内容が古い）の呼び出しが最新の状態を上書きしてしまう
 * （lost update）。`.kcfg`書き込み側の`configResource`（`services/document/config.ts`）と
 * 同じ`createKeyedMutex`をここでも使い、同一ファイルに対するアノテーションDBの読み書きを
 * すべてこの順序で直列化することで、呼び出しの完了順ではなく呼び出しの発生順で確実に反映されるようにする
 */
const annotationFileMutex = createKeyedMutex();

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
 * 設定ファイル（`.kcfg`）由来の確定済みアノテーション情報を、未保存のローカル編集・削除で
 * 上書きしないようDBへ反映する（仮登録IDの判定と登録を単一のDBトランザクションで実行する）
 */
export function registerConfigAnnotationInfos(
  file: ContainerElementFile,
  aInfo: AnnotationInfo[],
): Promise<Result<void>> {
  // 仮登録IDの判定・除外はリポジトリ側のトランザクション内で行うため実処理はそのまま委譲するが、
  // `registerAnnotationStyles`等の他の書き込みと同じファイル単位ロックを通すことで、
  // サービス層の読み込み〜書き込みの間に別の登録・削除が割り込む競合を防ぐ
  return annotationFileMutex.runExclusive(fileKey(file), () =>
    annotationRepository.registerConfigAnnotationInfos(file, aInfo),
  );
}

/**
 * アノテーションごとに、直近発火したコンテンツ再読み込みの世代番号を管理する
 *
 * サイズ・位置を短時間に連続して微調整すると、`loadAnnotContent`が複数同時に走ることになる。
 * 直接テキスト抽出（速い）とOCR経由（遅い）で所要時間が大きく異なるため、開始順序と完了順序が
 * 一致する保証がなく、対策なしでは古いジオメトリに対する読み込みが後から完了して最新の結果を
 * 上書きしてしまう（＝サイズを変えても「自身の値」が更新されないように見える）。
 * このMapで「そのアノテーションIDに対する最新の読み込み要求」を追跡し、完了時点で世代が
 * 一致する場合のみDBへ反映する
 */
const contentLoadGeneration = new Map<AnnotationID, number>();

/**
 * コンテンツ未読み込みのアノテーションにコンテンツを読み込んで付与する
 * TODO: 本来は文書種別をもとに処理を分岐すべき
 */
async function loadAnnotContent(
  file: ContainerElementFile,
  annotationInfo: AnnotationInfo,
  generation: number,
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

  // 読み込み中により新しいジオメトリ変更が発生していた場合、この結果はすでに古い。
  // そのままDBへ書き込むと、後発の読み込みが先に書き込んだ最新の結果を上書きしてしまうため、
  // 何もせずに終了する（後発側の書き込みだけを正としたい）
  if (contentLoadGeneration.get(annotationInfo.style.id) !== generation) return Success();

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
 * 保存前の1件分の`AnnotationInfo`を組み立てる（DBへの書き込みは行わない）
 *
 * `registerAnnotationStyles`が複数件をまとめて1回のDB書き込みにできるよう、
 * 書き込みを含まない部分だけを切り出したもの
 */
async function buildAnnotationInfo(
  aStyle: AnnotationStyle,
): Promise<{ info: AnnotationInfo; geometryChanged: boolean }> {
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

  const info: AnnotationInfo = {
    style: resolvedStyle,
    context: {
      // 位置・サイズが変わった場合は内容を読み取り直すため、再読込が完了するまでは
      // 「未読み込み」（undefined）として扱う。こうしないと、関係性検証が実際にはズレて
      // いるかもしれない古いOCR結果のまま一時的にOK/NGを表示してしまう。
      // 変わっていない場合のみ既存のOCR結果を引き継ぐ
      text: geometryChanged ? undefined : previous.ok ? previous.value.context.text : undefined,
    },
  };

  return { info, geometryChanged };
}

/**
 * 位置・サイズが変化したアノテーションについて、内容（テキスト抽出・OCR）の再読み込みを
 * 投げっぱなしで開始する（`registerAnnotationStyle`/`registerAnnotationStyles`共通）
 */
function scheduleContentReload(file: ContainerElementFile, info: AnnotationInfo): void {
  // このアノテーションIDに対する「最新の読み込み要求」として世代番号を発行する。
  // 完了時にこの世代が最新のままであれば書き込み、既に後発の要求に追い越されていれば
  // 書き込みを行わない（loadAnnotContent側・失敗時フォールバックの双方で参照する）
  const generation = (contentLoadGeneration.get(info.style.id) ?? 0) + 1;
  contentLoadGeneration.set(info.style.id, generation);

  // コンテンツの読み込みは投げっぱなしにするが、失敗時はcontext.textがundefinedのまま
  // DBに残り続けないよう、明示的に空文字列で確定させる（ただし、この間に後発の要求が
  // 発行されていた場合は、その要求の結果を上書きしないよう何もしない）
  void loadAnnotContent(file, info, generation).then((res) => {
    if (!res.ok && contentLoadGeneration.get(info.style.id) === generation) {
      void annotationRepository.updateAnnotationContentText(info.style.id, '');
    }
  });
}

/**
 * 複数のアノテーション情報を1回のDB書き込みでまとめて登録する
 *
 * 1件ずつ`registerAnnotationStyle`を呼ぶとDB書き込み（≒Vue側のライブクエリ再発火）が
 * 件数分に分かれ、複製・貼り付けしたアノテーション群が画面に1件ずつ遅れて表示されてしまう。
 * ペースト・複製など複数件を同時に確定させたい経路はこちらを使うこと
 */
export async function registerAnnotationStyles(
  file: ContainerElementFile,
  aStyles: AnnotationStyle[],
): Promise<Result<AnnotationInfo[]>> {
  // 同一ファイルへの他の登録・削除・並べ替え呼び出しと直列化する（`annotationFileMutex`参照）。
  // ロック区間は「既存内容の読み込み→書き込み」までに限り、fire-and-forgetの内容再読み込み
  // （`scheduleContentReload`）は待たない
  return annotationFileMutex.runExclusive(fileKey(file), async () => {
    const built = await Promise.all(aStyles.map((aStyle) => buildAnnotationInfo(aStyle)));

    const saveRes = await annotationRepository.addAnnotationInfos(
      file,
      built.map((b) => b.info),
    );
    if (!saveRes.ok) return saveRes;

    built.forEach(({ info, geometryChanged }) => {
      if (geometryChanged) scheduleContentReload(file, info);
    });

    return Success(built.map((b) => b.info));
  });
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
  const res = await registerAnnotationStyles(file, [aStyle]);
  if (!res.ok) return res;
  return Success(res.value[0]!);
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
  return annotationFileMutex.runExclusive(fileKey(file), () =>
    annotationRepository.addAnnotationInfos(file, aInfo, isTemporary),
  );
}

/**
 * 特定ファイルのアノテーションDBレコードをすべて削除する（未保存破棄時の再構築用）
 */
export function clearAnnotationsForFile(file: ContainerElementFile): Promise<Result<void>> {
  return annotationFileMutex.runExclusive(fileKey(file), () =>
    annotationRepository.deleteAnnotationsForFile(file),
  );
}

/**
 * DBに格納されている特定ファイルのアノテーションを保存する（＝仮フラグを撤去する）
 *
 * 保存したアノテーション一覧を返す
 */
export function saveAnnotationInfo(file?: ContainerElementFile): Promise<Result<AnnotationInfo[]>> {
  if (!file) return annotationRepository.commitAnnotations();
  return annotationFileMutex.runExclusive(fileKey(file), () =>
    annotationRepository.commitAnnotations(file),
  );
}

/**
 * 指定したアノテーションを仮フラグ付きで削除する
 *
 * 削除先のファイルを解決したうえで、そのファイルに対する他の登録・並べ替え呼び出しと
 * 直列化する（削除と、たまたま同時に進行中の編集の書き込みが入れ替わって、削除したはずの
 * アノテーションが編集内容ごと復活してしまう競合を防ぐ）。既に存在しない・削除済みで
 * アドレスを解決できない場合は競合の余地がないため、ロックなしでそのまま委譲する
 */
export async function removeAnnotationInfo(annotID: AnnotationID): Promise<Result<void>> {
  const addressRes = await annotationRepository.getAnnotationAddress(annotID);
  if (!addressRes.ok) return annotationRepository.softRemoveAnnotation(annotID);

  const key = fileKey({ containerID: addressRes.value.cID, path: addressRes.value.filePath });
  return annotationFileMutex.runExclusive(key, () =>
    annotationRepository.softRemoveAnnotation(annotID),
  );
}

/**
 * 複数のアノテーションを1回のDB書き込みでまとめて仮フラグ付きで削除する
 *
 * `removeAnnotationInfo`を件数分呼ぶと、ファイル単位の直列化（`annotationFileMutex`）を
 * 経由する都合上、書き込みが呼び出し順に1件ずつ直列実行されることになり、まとめて削除した
 * はずの複数選択・グループが画面上で1件ずつ遅れて消えていくように見えてしまう。
 * 複数選択・グループの削除はこちらを使うこと（対象がすべて同一ファイルに属することが前提）
 */
export function removeAnnotationInfos(
  file: ContainerElementFile,
  annotIDs: AnnotationID[],
): Promise<Result<void>> {
  return annotationFileMutex.runExclusive(fileKey(file), () =>
    annotationRepository.softRemoveAnnotations(annotIDs),
  );
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
  // 同一ファイルへの他の登録・削除呼び出しと直列化する（`annotationFileMutex`参照）
  return annotationFileMutex.runExclusive(fileKey(file), async () => {
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
  });
}

/**
 * 複数の注釈を複製し、指定したページへ貼り付ける（ペースト）
 *
 * 各`sources`要素を`duplicateAnnotation`で複製し、`offset`（呼び出し元が算出した文書座標系の
 * 移動量）だけ全要素を同じ量だけずらしながら`registerAnnotationStyles`で1回にまとめて保存する
 * （複数選択を一括ペーストした際の相対的な位置関係を保つと同時に、1件ずつ書き込むことで
 * 画面に段階的に表示されてしまうのを防ぐ）。複製元の`zIndex`をそのまま引き継ぐと
 * 重ね順キーが衝突するため、`zIndex`はリセットしcreatedAt基準に戻す
 */
export async function pasteAnnotations(
  file: ContainerElementFile,
  sources: AnnotationStyle[],
  pageNumber: number,
  offset: { dx: number; dy: number },
): Promise<Result<AnnotationInfo[]>> {
  const duplicated = sources.map((source) => ({
    ...duplicateAnnotation(source, pageNumber, source.x + offset.dx, source.y + offset.dy),
    zIndex: undefined,
  }));
  return registerAnnotationStyles(file, duplicated);
}
