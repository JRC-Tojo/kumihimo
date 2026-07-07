import type { ContainerElementFile, ContainerID, ContainerSkel } from 'src/models/container';
import { Success, type Result } from 'src/models/error/result';
import type { Relational, RelationalResponce } from 'src/models/relational/common';
import * as containerService from 'src/services/container/main';
import * as containerConfigService from 'src/services/container/config';
import * as docAnnotService from 'src/services/document/annotation';
import * as relationalRepository from 'src/repositories/db/relational';
import type { AnnotationID } from 'src/models/document/pdf';

/**
 * 読み込み中の関係性情報をすべて管理するDBを定義
 */
export function initRelationalDB(): Promise<Result<void>> {
  return relationalRepository.initRelationalDB();
}

/**
 * 保存済みの文書におけるアノテーションIDに紐づく関係性情報を取得
 *
 * 関係性情報はコンテナルートに保存されているため、ContainerIDのみで保存場所を特定して読み込む
 */
export async function loadRelationals(cID: ContainerID): Promise<Result<Relational[]>> {
  const container = containerService.getContainer(cID);
  if (!container.ok) return container;

  const relationals = await loadCachedRelationals(container.value);
  if (!relationals.ok) return relationals;

  const storeRes = await relationalRepository.addCachedRelationals(cID, relationals.value);
  if (!storeRes.ok) return storeRes;

  return relationals;
}

/**
 * 特定のファイルをsource側とするRelational一覧をDBから取得して返す
 */
export function getRelationals(file: ContainerElementFile): Promise<Result<Relational[]>> {
  return relationalRepository.getRelationalsByFile(file);
}

/**
 * 指定した関係性一覧を検証する
 */
export async function checkRelational(r: Relational): Promise<Result<RelationalResponce>> {
  const srcContent = await docAnnotService.getAnnotationInfo(r.srcID);
  if (!srcContent.ok) return srcContent;
  const targetContent = await docAnnotService.getAnnotationInfo(r.targetID);
  if (!targetContent.ok) return targetContent;

  // .text=undefinedは読み込み中を示しているが、関係性としては失敗扱いにする必要がないため空文字列で処理する
  const checkedRule = validRelational(
    r,
    srcContent.value.context.text ?? '',
    targetContent.value.context.text ?? '',
  );

  return Success(checkedRule);
}

/**
 * 関係性を仮フラグを付けて新しく定義する
 */
export async function registRelational(
  newRelational: Relational,
): Promise<Result<RelationalResponce>> {
  const saveRes = await relationalRepository.addRelational(newRelational);
  if (!saveRes.ok) return saveRes;

  return checkRelational(newRelational);
}

/**
 * 指定したアノテーションに紐づく関係性を仮フラグ付きでをすべて削除する
 */
export function removeRelationals(srcID: AnnotationID): Promise<Result<void>> {
  return relationalRepository.softRemoveRelationalsBySrcID(srcID);
}

/**
 * DBに格納されている特定ファイルの関係性を保存する（＝仮フラグを撤去する）
 *
 * 保存した関係性一覧を返す
 */
export function saveRelationals(file: ContainerElementFile): Promise<Result<Relational[]>> {
  return relationalRepository.commitRelationals(file);
}

/**
 * コンテナルートにキャッシュされた関係性情報を読み込む
 */
async function loadCachedRelationals(c: ContainerSkel): Promise<Result<Relational[]>> {
  // 関係性情報の元データを取得
  const relFileContent = await containerConfigService.getRelationalFile(c.id);
  if (!relFileContent.ok) return relFileContent;

  // 取得したデータの中からtargetAnnotIDの情報に絞る
  const relationalsFromFile = relFileContent.value.relationals;
  const relationals = relationalsFromFile
    .map((r) => {
      const srcFile = relFileContent.value.annotIdToFileInfo[r.src];
      const targetFile = relFileContent.value.annotIdToFileInfo[r.target];

      // キャッシュファイルはシステム管理のため、原則すべてのAnnotationIDに対してファイル情報が付与されているはず
      // ファイルの存在有無はこの段階では検証しない
      if (!srcFile || !targetFile) return '';

      return {
        srcFile,
        srcID: r.src,
        targetFile,
        targetID: r.target,
        rule: r.rule,
      };
    })
    .filter((r) => r !== '');

  return Success(relationals);
}

/**
 * 関係性を検証する
 */
function validRelational(
  relational: Relational,
  srcVal: string,
  targetVal: string,
): RelationalResponce {
  let isOK = true;
  switch (relational.rule.type) {
    case 'link':
      break;
    case 'equal':
      isOK = srcVal === targetVal;
      break;
  }

  return {
    srcID: relational.srcID,
    targetID: relational.targetID,
    srcVal,
    targetVal,
    checkedRule: { rule: relational.rule, isOK },
  };
}
