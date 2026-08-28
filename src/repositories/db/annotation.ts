import type { Observable } from 'dexie';
import Dexie, { liveQuery, type Table } from 'dexie';
import type { ContainerElementFile, ContainerID } from 'src/models/container';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import type { Result } from 'src/models/error/result';
import { Failure, NotFoundError, Success, toError } from 'src/models/error/result';
import type { AnnotationBaseAddress, AnnotationInfo } from 'src/models/relational/fileSchema';

interface AnnotationRecord {
  id: AnnotationID;
  containerID: ContainerID;
  filePath: string;
  annotationInfo: AnnotationInfo;
  isTemporary: boolean;
  isDeleted: boolean;
  updatedAt: string;
}

class AnnotationDexieDB extends Dexie {
  annotations!: Table<AnnotationRecord, string>;

  constructor() {
    super('relational-documents-annotations');
    this.version(1).stores({
      annotations: 'id, containerID, filePath, isTemporary, isDeleted, updatedAt',
    });
  }
}

const db = new AnnotationDexieDB();

function toAnnotationRecord(
  file: ContainerElementFile,
  aInfo: AnnotationInfo,
  isTemporary = true,
): AnnotationRecord {
  return {
    id: aInfo.style.id,
    containerID: file.containerID,
    filePath: file.path,
    annotationInfo: aInfo,
    isTemporary,
    isDeleted: false,
    updatedAt: new Date().toISOString(),
  };
}

async function ensureReady(): Promise<Result<void>> {
  try {
    await db.open();
    return Success();
  } catch (error) {
    return Failure(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * 読み込み中の文書におけるアノテーション一覧を格納するDBを初期化する
 */
export async function initAnnotDB(): Promise<Result<void>> {
  return ensureReady();
}

/**
 * DBに記録されているアノテーションの元データを取得する
 */
async function getAnnotationRecord(annotID: AnnotationID): Promise<Result<AnnotationRecord>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    const record = await db.annotations.get(annotID);
    if (!record || record.isDeleted) return Failure(new NotFoundError('annotation not found'));
    return Success(record);
  } catch (error) {
    return Failure(toError(error));
  }
}

/**
 * DBからアノテーション情報を取得する
 */
export async function getAnnotationInfo(annotID: AnnotationID): Promise<Result<AnnotationInfo>> {
  const record = await getAnnotationRecord(annotID);
  if (!record.ok) return record;
  return Success(record.value.annotationInfo);
}

/**
 * DBからアノテーションの保存パスを取得する
 */
export async function getAnnotationAddress(
  annotID: AnnotationID,
): Promise<Result<AnnotationBaseAddress>> {
  const record = await getAnnotationRecord(annotID);
  if (!record.ok) return record;
  return Success({ cID: record.value.containerID, filePath: record.value.filePath });
}

/**
 * アノテーション情報を追加する
 *
 * @param isTemporary 未保存の仮登録として追加するか。`.kcfg`から読み込んだ確定済みデータを
 * 反映する場合は`false`を指定する（`true`のまま追加すると、編集していないファイルを開いただけで
 * 「未保存の変更あり」判定になってしまう）
 */
export async function addAnnotationInfos(
  file: ContainerElementFile,
  aInfos: AnnotationInfo[],
  isTemporary = true,
): Promise<Result<void>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    const rawedRecords = JSON.parse(
      JSON.stringify(aInfos.map((aInfo) => toAnnotationRecord(file, aInfo, isTemporary))),
    );
    await db.annotations.bulkPut(rawedRecords);
    return Success();
  } catch (error) {
    return Failure(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * アノテーションのOCR/テキスト抽出結果（`context.text`）のみをDBへ反映する
 *
 * OCR処理は非同期で時間がかかるため、完了時には呼び出し時点で捕捉した`style`（位置・形状）が
 * 別の編集によって古くなっている可能性がある。`addAnnotationInfos`のようにレコード全体を
 * `bulkPut`で上書きすると、その間に行われた頂点ドラッグ等の編集結果を古い`style`で
 * 巻き戻してしまうため、`context.text`のみをドット記法で部分更新し、styleには触れない
 */
export async function updateAnnotationContentText(
  annotID: AnnotationID,
  text: string,
): Promise<Result<void>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    // 対象レコードが編集や削除で既に存在しない場合、updateは何もせず0を返す（エラーにはならない）
    await db.annotations.update(annotID, { 'annotationInfo.context.text': text });
    return Success();
  } catch (error) {
    return Failure(toError(error));
  }
}

/**
 * アノテーションのスタイル（`style`）のみをDBへ反映する
 *
 * 重ね順（zIndex）変更など、既存のOCR抽出結果（`context.text`）を保持したまま`style`だけを
 * 更新したい場合に使う。`addAnnotationInfos`のようにレコード全体を`bulkPut`で上書きすると
 * `context`が新規登録扱いで巻き戻ってしまうため、`annotationInfo.style`のみをドット記法で
 * 部分更新し、contextには触れない
 */
export async function updateAnnotationStyle(style: AnnotationStyle): Promise<Result<void>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    const rawStyle = JSON.parse(JSON.stringify(style));
    await db.annotations.update(style.id, {
      'annotationInfo.style': rawStyle,
      updatedAt: new Date().toISOString(),
    });
    return Success();
  } catch (error) {
    return Failure(toError(error));
  }
}

/**
 * 特定ファイルのアノテーションDBレコードをすべて削除する
 *
 * 「保存せず閉じる」際、仮登録・確定済み問わずこのファイルの記録を一旦すべて消し去り、
 * `.kcfg`から読み直して確定済み状態を再構築するために使う（生き残らせたい行を判定する
 * 必要がなく、常に正しい状態へ戻せる）
 */
export async function deleteAnnotationsForFile(file: ContainerElementFile): Promise<Result<void>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    await db.annotations
      .where('containerID')
      .equals(file.containerID)
      .filter((row) => row.filePath === file.path)
      .delete();
    return Success();
  } catch (error) {
    return Failure(toError(error));
  }
}

/**
 * 特定のファイルのアノテーション情報をDBから取得する
 */
export async function getAnnotationsByFile(
  file: ContainerElementFile,
): Promise<Result<AnnotationInfo[]>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    const rows = await db.annotations
      .where('containerID')
      .equals(file.containerID)
      .filter((row) => row.filePath === file.path && !row.isDeleted)
      .toArray();
    return Success(rows.map((row) => row.annotationInfo));
  } catch (error) {
    return Failure(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * 特定ファイルに紐づく未保存（仮登録）のアノテーション件数を取得する
 */
export async function countTemporaryAnnotations(
  file: ContainerElementFile,
): Promise<Result<number>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    const count = await db.annotations
      .where('containerID')
      .equals(file.containerID)
      .filter((row) => row.filePath === file.path && row.isTemporary && !row.isDeleted)
      .count();
    return Success(count);
  } catch (error) {
    return Failure(toError(error));
  }
}

/**
 * アノテーション情報一覧から、仮登録（isTemporary: true）のIDに該当するものを除外する
 *
 * `.kcfg`から読み込んだ確定済みデータで、まだ`.kcfg`に反映されていないローカルの編集・削除を
 * 上書きしないようにするための純粋なフィルタ処理。DBアクセスを含まないため単体でテストできる
 */
export function excludeTemporaryAnnotationInfos(
  aInfos: AnnotationInfo[],
  temporaryIds: Set<AnnotationID>,
): AnnotationInfo[] {
  // 各AnnotationInfoのスタイルIDが仮登録ID集合に含まれるものだけを取り除いて返す
  return aInfos.filter((aInfo) => !temporaryIds.has(aInfo.style.id));
}

/**
 * 設定ファイル（`.kcfg`）から読み込んだ確定済みアノテーション情報を、ローカルで未保存の
 * 編集・削除（isTemporary: true）があるものを除いてDBへ反映する
 *
 * 仮登録IDの判定（`getTemporaryAnnotationIds`相当）と登録（`addAnnotationInfos`相当）を
 * 同一のDexieトランザクション内で行うことで、判定後・登録前に別の書き込み（blur等による
 * isTemporary更新）が割り込み、その新しいローカル状態を古い`.kcfg`の内容で上書きしてしまう
 * 競合を防ぐ
 */
export async function registerConfigAnnotationInfos(
  file: ContainerElementFile,
  aInfos: AnnotationInfo[],
): Promise<Result<void>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    await db.transaction('rw', db.annotations, async () => {
      const temporaryRows = await db.annotations
        .where('containerID')
        .equals(file.containerID)
        .filter((row) => row.filePath === file.path && row.isTemporary)
        .toArray();
      const temporaryIds = new Set(temporaryRows.map((row) => row.id));

      const safeInfos = excludeTemporaryAnnotationInfos(aInfos, temporaryIds);
      const rawedRecords = JSON.parse(
        JSON.stringify(safeInfos.map((aInfo) => toAnnotationRecord(file, aInfo, false))),
      );
      await db.annotations.bulkPut(rawedRecords);
    });
    return Success();
  } catch (error) {
    return Failure(toError(error));
  }
}

/**
 * 特定ファイルに紐づく未保存（仮登録）のアノテーションIDを取得する
 *
 * `loadConfig`が`.kcfg`の内容をDBへ反映する際、まだ`.kcfg`に保存されていないローカルの
 * 編集・削除がある注釈を古いスナップショットで上書きしないよう、対象IDを除外するために使う
 * （`countTemporaryAnnotations`と異なり、ソフト削除（`isDeleted: true`）の行も含める＝
 * 削除直後にタブを切り替えて戻った際に、削除した注釈が復活するのを防ぐため）
 */
export async function getTemporaryAnnotationIds(
  file: ContainerElementFile,
): Promise<Result<Set<AnnotationID>>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    const rows = await db.annotations
      .where('containerID')
      .equals(file.containerID)
      .filter((row) => row.filePath === file.path && row.isTemporary)
      .toArray();
    return Success(new Set(rows.map((row) => row.id)));
  } catch (error) {
    return Failure(toError(error));
  }
}

/**
 * DexieのLiveQueryを利用して特定ファイルのアノテーション情報を購読する
 */
export function observedAnnotationStylesByFile(
  file: ContainerElementFile,
): Observable<AnnotationStyle[]> {
  const observed = liveQuery(() =>
    db.annotations
      .where('containerID')
      .equals(file.containerID)
      .filter((row) => row.filePath === file.path && !row.isDeleted)
      .toArray((annotRec) => annotRec.map((annot) => annot.annotationInfo.style)),
  );

  return observed;
}

/**
 * DBに格納されている特定ファイルのアノテーションを保存する（＝仮フラグを撤去する）
 */
export async function commitAnnotations(
  file?: ContainerElementFile,
): Promise<Result<AnnotationInfo[]>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    const query = file
      ? db.annotations
          .where('containerID')
          .equals(file.containerID)
          .filter((row) => row.filePath === file.path && row.isTemporary && !row.isDeleted)
      : db.annotations.filter((row) => row.isTemporary && !row.isDeleted);

    const rows = await query.toArray();
    if (rows.length === 0) return Success([]);

    await db.transaction('rw', db.annotations, async () => {
      await Promise.all(
        rows.map((row) =>
          db.annotations.update(row.id, {
            isTemporary: false,
            updatedAt: new Date().toISOString(),
          }),
        ),
      );
    });

    return Success(rows.map((row) => row.annotationInfo));
  } catch (error) {
    return Failure(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * 特定ファイルのアノテーション記録のfilePathを付け替える（リネーム・移動時の追従用）
 */
export async function remapFilePath(
  containerID: ContainerID,
  oldPath: string,
  newPath: string,
): Promise<Result<void>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    await db.annotations
      .where('containerID')
      .equals(containerID)
      .filter((row) => row.filePath === oldPath)
      .modify({ filePath: newPath, updatedAt: new Date().toISOString() });
    return Success();
  } catch (error) {
    return Failure(toError(error));
  }
}

/**
 * 指定したアノテーションを仮フラグ付きで削除する
 */
export async function softRemoveAnnotation(annotID: AnnotationID): Promise<Result<void>> {
  const ready = await ensureReady();
  if (!ready.ok) return ready;

  try {
    const existing = await db.annotations.get(annotID);
    if (!existing) return Success();

    await db.annotations.update(annotID, {
      isDeleted: true,
      isTemporary: true,
      updatedAt: new Date().toISOString(),
    });
    return Success();
  } catch (error) {
    return Failure(error instanceof Error ? error : new Error(String(error)));
  }
}
