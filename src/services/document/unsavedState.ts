/**
 * ファイルに未保存（仮登録）のアノテーション・関係性が存在するかどうかを判定する
 */
import { liveQuery, type Observable } from 'dexie';
import type { ContainerElementFile } from 'src/models/container';
import { Success, type Result } from 'src/models/error/result';
import * as annotationService from 'src/services/document/annotation';
import * as relationalService from 'src/services/document/relational';

/**
 * 指定ファイルに未保存の変更（アノテーション・関係性のいずれか）があるかどうかを判定する
 */
export async function hasUnsavedChangesByFile(
  file: ContainerElementFile,
): Promise<Result<boolean>> {
  const [annotRes, relRes] = await Promise.all([
    annotationService.countTemporaryAnnotations(file),
    relationalService.countTemporaryRelationalsInvolvingFile(file),
  ]);
  const annotCount = annotRes.ok ? annotRes.value : 0;
  const relCount = relRes.ok ? relRes.value : 0;
  return Success(annotCount + relCount > 0);
}

/**
 * 指定ファイルの未保存状態をDBの変更に応じて購読する
 *
 * アノテーションDB・関係性DBは別のDexieインスタンスだが、liveQueryは
 * クエリ関数内で同期的にアクセスした全テーブル（DBインスタンス問わず）を横断して
 * 変更追跡するため、1つのliveQuery内で両方の件数チェックをまとめてよい
 */
export function observedHasUnsavedChangesByFile(file: ContainerElementFile): Observable<boolean> {
  return liveQuery(async () => {
    const res = await hasUnsavedChangesByFile(file);
    return res.ok ? res.value : false;
  });
}
