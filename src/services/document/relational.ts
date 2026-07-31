import type { ContainerElementFile, ContainerID, ContainerSkel } from 'src/models/container';
import { Failure, Success, type Result } from 'src/models/error/result';
import type {
  Relational,
  RelationalResponce,
  RelationalWithAddress,
} from 'src/models/relational/common';
import type {
  AnnotationBaseAddress,
  AnnotationInfo,
  RelationalRule,
} from 'src/models/relational/fileSchema';
import {
  DEFAULT_RELAXATION_OPTIONS,
  type RelaxationOptions,
} from 'src/models/relational/relaxation';
import * as containerService from 'src/services/container/main';
import * as containerConfigService from 'src/services/container/config';
import * as docAnnotService from 'src/services/document/annotation';
import * as relationalRepository from 'src/repositories/db/relational';
import type { AnnotationID } from 'src/models/document/pdf';
import { resolveCachedContainerID } from 'src/services/document/containerIdResolver';
import { getSettings } from 'src/settings/main';
import { relaxedEqual } from 'src/utils/text/relaxedCompare';
import { evaluateFormula, parseNumericValue } from 'src/utils/calculation/formula';

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

  const loadRes = await loadCachedRelationals(container.value);
  if (!loadRes.ok) return loadRes;

  const relationalWithAddresses = loadRes.value;
  const storeRes = await relationalRepository.addCachedRelationals(relationalWithAddresses);
  if (!storeRes.ok) return storeRes;

  return Success(relationalWithAddresses.map((r) => r.relational));
}

/**
 * 特定のファイルをsource側とするRelational一覧をDBから取得して返す
 */
export function getRelationals(file: ContainerElementFile): Promise<Result<Relational[]>> {
  return relationalRepository.getRelationalsByFile(file);
}

/**
 * アドレス情報（コンテナID・ファイルパス）から実際のContainerElementFileを解決する
 *
 * 対象コンテナがまだ読み込まれていない場合はcontainerService.loadContainerで読み込む
 */
async function resolveFileByAddress(
  address: AnnotationBaseAddress,
): Promise<Result<ContainerElementFile>> {
  const container = await containerService.loadContainer(address.cID);
  if (!container.ok) return container;

  const elem = container.value.elements[address.filePath];
  if (elem === undefined || elem.type !== 'File') {
    return Failure(new Error(`Not Found File (path: ${address.filePath})`));
  }

  return Success(elem);
}

/**
 * アノテーション内容をDBから取得する
 *
 * DBにまだ無い場合（対象文書が今回のセッションで一度も開かれていない場合）は、対応する`.kcfg`を
 * 直接読み込んでDBへ反映してから返す。関係性の検証はリンク先文書を開かなくても実行できる必要が
 * あるが、アノテーションDBは開いた文書のセッション中のキャッシュに過ぎないため、フォールバック先
 * として保存済みの確定データである`.kcfg`を読みにいく
 */
async function ensureAnnotationInfo(
  annotID: AnnotationID,
  address: AnnotationBaseAddress,
): Promise<Result<AnnotationInfo>> {
  const cached = await docAnnotService.getAnnotationInfo(annotID);
  if (cached.ok) return cached;

  const file = await resolveFileByAddress(address);
  if (!file.ok) return cached;

  const configRes = await containerConfigService.getDocumentConfigFile(address.cID, file.value);
  if (!configRes.ok) return cached;

  const annotInfo = configRes.value.annots[annotID];
  if (annotInfo === undefined) return cached;

  const registRes = await docAnnotService.registerAnnotationInfo([annotInfo], file.value, false);
  if (!registRes.ok) return cached;

  return Success(annotInfo);
}

/**
 * 指定した関係性一覧を検証する
 */
export async function checkRelational(
  r: RelationalWithAddress,
): Promise<Result<RelationalResponce>> {
  const srcContent = await ensureAnnotationInfo(r.relational.srcID, r.srcAddress);
  if (!srcContent.ok) return srcContent;
  const targetContent = await ensureAnnotationInfo(r.relational.targetID, r.targetAddress);
  if (!targetContent.ok) return targetContent;

  // .textが読み込み中の場合はundefinedのため、関係性の検証を省略する
  // （OCR結果が空文字列''になるケースは「読み込み済みだが内容が空」であり、これは未読み込み(undefined)とは区別する）
  const srcContentTxt = srcContent.value.context.text;
  const targetContentTxt = targetContent.value.context.text;
  if (srcContentTxt === undefined || targetContentTxt === undefined) {
    return Failure(new Error('An annotation content is not loaded yet'));
  }

  const checkedRule = await validRelational(r.relational, srcContentTxt, targetContentTxt);

  return Success(checkedRule);
}

/**
 * 関係性を検証する（失敗しないバージョン）
 *
 * アノテーション内容（OCR結果等）の読み込みが完了していない場合、checkRelationalは失敗するが
 * それは「検証保留」を意味するだけなので、checkedRule: undefinedとして常に成功を返す
 */
export async function checkRelationalSafe(r: RelationalWithAddress): Promise<RelationalResponce> {
  const checkedRes = await checkRelational(r);
  if (checkedRes.ok) return checkedRes.value;

  return {
    srcID: r.relational.srcID,
    targetID: r.relational.targetID,
    srcVal: '',
    targetVal: '',
    checkedRule: undefined,
  };
}

/**
 * 関係性を仮フラグを付けて新しく定義する
 */
export async function registRelational(
  newRelational: Relational,
): Promise<Result<RelationalResponce>> {
  const srcAddress = await docAnnotService.getAnnotationAddress(newRelational.srcID);
  if (!srcAddress.ok) return srcAddress;
  const targetAddress = await docAnnotService.getAnnotationAddress(newRelational.targetID);
  if (!targetAddress.ok) return targetAddress;
  const saveRes = await relationalRepository.addRelational(
    newRelational,
    srcAddress.value,
    targetAddress.value,
  );
  if (!saveRes.ok) return saveRes;

  return Success(
    await checkRelationalSafe({
      relational: newRelational,
      srcAddress: srcAddress.value,
      targetAddress: targetAddress.value,
    }),
  );
}

/**
 * 指定ファイルがsrc・target問わずどちらかの側で関わっているRelational一覧を取得する
 */
export function getRelationalsInvolvingFile(
  file: ContainerElementFile,
): Promise<Result<RelationalWithAddress[]>> {
  return relationalRepository.getRelationalsInvolvingFile(file);
}

/**
 * 指定ファイルがsrc・target問わずどちらかの側で関わる未保存（仮登録）の関係性件数を取得する
 */
export function countTemporaryRelationalsInvolvingFile(
  file: ContainerElementFile,
): Promise<Result<number>> {
  return relationalRepository.countTemporaryRelationalsInvolvingFile(file);
}

/**
 * コンテナ内の関係性キャッシュ（`.kumihimo/relational.json`）が参照しているファイルパス一覧を取得する
 *
 * 「関係性で関連づけられているファイル」を、実際に開いているかどうかに関わらず特定するために使う
 * （変更検知バナーの表示要否を判定する際、関連ファイルの範囲として利用する）
 */
export async function getReferencedFilePaths(cID: ContainerID): Promise<Result<string[]>> {
  const relFile = await containerConfigService.getRelationalFile(cID);
  if (!relFile.ok) return relFile;

  const paths = new Set(Object.values(relFile.value.annotIdToFileInfo).map((a) => a.filePath));
  return Success(Array.from(paths));
}

/**
 * 指定したアノテーションに紐づく関係性を仮フラグ付きでをすべて削除する
 */
export function removeRelationals(srcID: AnnotationID): Promise<Result<void>> {
  return relationalRepository.softRemoveRelationalsBySrcID(srcID);
}

/**
 * srcID・targetIDが一致する1本の関係性のみを削除する（リンクの変更・個別削除用）
 */
export function removeRelationalEdge(
  srcID: AnnotationID,
  targetID: AnnotationID,
): Promise<Result<void>> {
  return relationalRepository.softRemoveRelationalEdge(srcID, targetID);
}

/**
 * 指定したアノテーションがsrc・target問わずどちらかの側で関わる関係性をすべて削除する
 *
 * アノテーション自体が削除された際、紐づく関係性を孤立させないためのクリーンアップ用
 */
export function removeRelationalsForAnnotation(annotID: AnnotationID): Promise<Result<void>> {
  return relationalRepository.softRemoveRelationalsByAnnotationID(annotID);
}

/**
 * アノテーションIDから、そのアノテーションが属するファイル情報を解決する
 *
 * 関係性は別コンテナのアノテーション同士でも定義できるため、対象コンテナが
 * まだ読み込まれていない場合はcontainerService.loadContainerで読み込む
 */
export async function resolveAnnotationFile(
  annotID: AnnotationID,
): Promise<Result<ContainerElementFile>> {
  const address = await docAnnotService.getAnnotationAddress(annotID);
  if (!address.ok) return address;

  return resolveFileByAddress(address.value);
}

/**
 * アノテーションIDから、そのアノテーションが存在するページ番号を解決する
 *
 * 「対になるアノテーション」の文書を開く際、先頭ページではなく実際のページへ遷移させるために使う
 */
export async function getAnnotationPageNumber(annotID: AnnotationID): Promise<Result<number>> {
  const address = await docAnnotService.getAnnotationAddress(annotID);
  if (!address.ok) return address;

  const info = await ensureAnnotationInfo(annotID, address.value);
  if (!info.ok) return info;

  return Success(info.value.style.pageNumber);
}

/**
 * DBに格納されている特定ファイルの関係性を保存する（＝仮フラグを撤去する）
 *
 * 保存した関係性一覧を返す
 */
export function saveRelationals(
  file: ContainerElementFile,
): Promise<Result<RelationalWithAddress[]>> {
  return relationalRepository.commitRelationals(file);
}

/**
 * 指定ファイルが関わる未保存（仮登録）の関係性を破棄し、最後に保存された状態へ戻す
 *
 * 仮登録・確定済み問わずこのファイルが関わる関係性DBレコードをすべて削除したうえで、
 * コンテナルートのキャッシュ（`.kumihimo/relational.json`）からこのファイルが関わる分だけを
 * 読み直して確定済み状態として再登録する（新規追加・仮削除いずれのケースも区別なく正しく戻せる）
 */
export async function discardUnsavedRelationalsInvolvingFile(
  file: ContainerElementFile,
): Promise<Result<void>> {
  const container = containerService.getContainer(file.containerID);
  if (!container.ok) return container;

  const deleteRes = await relationalRepository.deleteRelationalsInvolvingFile(file);
  if (!deleteRes.ok) return deleteRes;

  const cachedRes = await loadCachedRelationals(container.value);
  if (!cachedRes.ok) return cachedRes;

  const involvingFile = cachedRes.value.filter(
    (r) => r.srcAddress.filePath === file.path || r.targetAddress.filePath === file.path,
  );
  if (involvingFile.length === 0) return Success();

  return relationalRepository.addCachedRelationals(involvingFile);
}

/**
 * ファイルのリネーム・移動に伴い、読み込み中の関係性記録のfilePathを付け替える
 */
export function remapFilePath(
  containerID: ContainerID,
  oldPath: string,
  newPath: string,
): Promise<Result<void>> {
  return relationalRepository.remapFilePath(containerID, oldPath, newPath);
}

/**
 * コンテナルートにキャッシュされた関係性情報を読み込む
 */
async function loadCachedRelationals(c: ContainerSkel): Promise<Result<RelationalWithAddress[]>> {
  // 関係性情報の元データを取得
  const relFileContent = await containerConfigService.getRelationalFile(c.id);
  if (!relFileContent.ok) return relFileContent;

  // 取得したデータの中からtargetAnnotIDの情報に絞る
  const relationalsFromFile = relFileContent.value.relationals;
  const relationals: RelationalWithAddress[] = relationalsFromFile
    .map((r) => {
      const srcFile = relFileContent.value.annotIdToFileInfo[r.src];
      const targetFile = relFileContent.value.annotIdToFileInfo[r.target];

      // キャッシュファイルはシステム管理のため、原則すべてのAnnotationIDに対してファイル情報が付与されているはず
      // ファイルの存在有無はこの段階では検証しない
      if (!srcFile || !targetFile) return '';

      return {
        relational: {
          srcID: r.src,
          targetID: r.target,
          rule: r.rule,
        },
        srcAddress: {
          ...srcFile,
          cID: resolveCachedContainerID(
            srcFile.cID,
            c.id,
            (id) => containerService.getContainer(id).ok,
          ),
        },
        targetAddress: {
          ...targetFile,
          cID: resolveCachedContainerID(
            targetFile.cID,
            c.id,
            (id) => containerService.getContainer(id).ok,
          ),
        },
      };
    })
    .filter((r) => r !== '');

  return Success(relationals);
}

/**
 * 等値検証で使う緩和ルールを決定する
 *
 * アノテーション別設定（`rule.relaxation`）がある場合はアプリ設定を完全に無視して
 * それだけを使う（合成ではなく完全上書き）。無い場合のみアプリ設定にフォールバックする
 */
async function resolveRelaxationOptions(
  rule: Extract<RelationalRule, { type: 'equal' }>,
): Promise<RelaxationOptions> {
  if (rule.relaxation !== undefined) return rule.relaxation;

  const settingsRes = await getSettings();
  return settingsRes.ok ? settingsRes.value.relationalRelaxation : DEFAULT_RELAXATION_OPTIONS;
}

/**
 * 比較前の値に計算式を適用する（単位変換等）
 *
 * 抽出値が数値として解釈できない場合や式が不正な場合は、計算を行わず生値のまま比較する
 */
function applyFormula(rawText: string, formula: string | undefined): string {
  if (formula === undefined) return rawText;

  const x = parseNumericValue(rawText.normalize('NFKC'));
  if (x === undefined) return rawText;

  const result = evaluateFormula(formula, x);
  return result === undefined ? rawText : String(result);
}

/**
 * 関係性を検証する
 *
 * 表示用の`srcVal`/`targetVal`は緩和・計算を適用する前の生の抽出値のまま返す
 * （画面には常に実際にOCR等で読み取った値を表示する）
 */
async function validRelational(
  relational: Relational,
  srcVal: string,
  targetVal: string,
): Promise<RelationalResponce> {
  let isOK = true;
  switch (relational.rule.type) {
    case 'link':
      break;
    case 'equal': {
      const rule = relational.rule;
      const relaxation = await resolveRelaxationOptions(rule);
      const srcComparisonVal = applyFormula(srcVal, rule.srcFormula);
      const targetComparisonVal = applyFormula(targetVal, rule.targetFormula);
      isOK = relaxedEqual(srcComparisonVal, targetComparisonVal, relaxation);
      break;
    }
  }

  return {
    srcID: relational.srcID,
    targetID: relational.targetID,
    srcVal,
    targetVal,
    checkedRule: { rule: relational.rule, isOK },
  };
}
