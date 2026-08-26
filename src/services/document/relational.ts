import type { ContainerElementFile, ContainerID, ContainerSkel } from 'src/models/container';
import { Failure, NotFoundError, Success, type Result } from 'src/models/error/result';
import type {
  Relational,
  RelationalResponce,
  RelationalWithAddress,
} from 'src/models/relational/common';
import type {
  AnnotationBaseAddress,
  AnnotationInfo,
  RelationalEndpointID,
  RelationalRule,
} from 'src/models/relational/fileSchema';
import {
  DEFAULT_RELAXATION_OPTIONS,
  type RelaxationOptions,
} from 'src/models/relational/relaxation';
import * as containerService from 'src/services/container/main';
import * as containerConfigService from 'src/services/container/config';
import * as docAnnotService from 'src/services/document/annotation';
import * as annotationGroupService from 'src/services/document/annotationGroup';
import * as relationalRepository from 'src/repositories/db/relational';
import type { AnnotationID } from 'src/models/document/pdf';
import type { AnnotationGroupID } from 'src/models/document/group';
import { resolveCachedContainerID } from 'src/services/document/containerIdResolver';
import { relaxedEqual } from 'src/utils/text/relaxedCompare';
import {
  evaluateExpression,
  evaluateFormula,
  parseNumericValue,
  roundFormulaResult,
} from 'src/utils/calculation/formula';
import { letterForMemberIndex } from 'src/utils/calculation/groupFormula';
import type { GroupValueAggregation } from 'src/models/document/group';

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
export async function ensureAnnotationInfo(
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
 * 関係性の端点（アノテーション or グループ）が取りうる値の状態
 *
 * - ready: 値が確定している
 * - pending: OCR等の内容読み込みが完了していない（そのうち解決される可能性がある）
 * - unresolvable: グループの値算出方法が未設定など、ユーザーの操作なしには解決しない
 */
type EndpointValueState =
  { status: 'ready'; value: string } | { status: 'pending' } | { status: 'unresolvable' };

/**
 * 関係性の端点（アノテーションIDまたはグループID）のアドレスを解決する
 *
 * まずアノテーションとして解決を試み、見つからない場合はグループとして解決する
 * （UUID自体にはアノテーション/グループの区別が無いため、実体を引けるかどうかで判定する）
 */
async function resolveEndpointAddress(
  id: RelationalEndpointID,
): Promise<Result<AnnotationBaseAddress>> {
  const annotAddress = await docAnnotService.getAnnotationAddress(id as AnnotationID);
  if (annotAddress.ok) return annotAddress;
  if (!(annotAddress.error instanceof NotFoundError)) return annotAddress;

  return annotationGroupService.getGroupAddress(id as AnnotationGroupID);
}

/**
 * グループ全体を代表する値を、メンバーの値算出方法に従って算出する
 *
 * 'sum'：欠損メンバーや非数値のメンバーは合計から除外する（安全側に倒し、算出自体を失敗させない）。
 * 'formula'：`memberIds`の順序から導出した変数名（A, B, C...）で各メンバーの数値を参照する式を
 * 評価する。'sum'と異なり、いずれかのメンバーが欠損・非数値の場合は式全体が意味を持たなくなる
 * ため、部分的に除外するのではなく'unresolvable'として扱う（未定義変数参照・0除算・構文エラーも
 * 同様にevaluateExpressionがundefinedを返すことで一括して'unresolvable'に落ちる）
 */
async function resolveGroupValue(
  memberIds: AnnotationID[],
  groupAddress: AnnotationBaseAddress,
  aggregation: GroupValueAggregation,
): Promise<EndpointValueState> {
  const memberValues: (number | undefined)[] = [];
  let anyPending = false;

  for (const memberId of memberIds) {
    const info = await ensureAnnotationInfo(memberId, groupAddress);
    if (!info.ok) {
      memberValues.push(undefined);
      continue;
    }

    const text = info.value.context.text;
    if (text === undefined) {
      anyPending = true;
      memberValues.push(undefined);
      continue;
    }

    memberValues.push(parseNumericValue(text.normalize('NFKC')));
  }

  if (anyPending) return { status: 'pending' };

  if (aggregation.type === 'sum') {
    const sum = memberValues.reduce<number>((total, value) => total + (value ?? 0), 0);
    return { status: 'ready', value: String(sum) };
  }

  const variables: Record<string, number> = {};
  let missingMember = false;
  memberIds.forEach((_, index) => {
    const value = memberValues[index];
    if (value === undefined) {
      missingMember = true;
      return;
    }
    variables[letterForMemberIndex(index)] = value;
  });
  if (missingMember) return { status: 'unresolvable' };

  const result = evaluateExpression(aggregation.expression, variables);
  if (result === undefined) return { status: 'unresolvable' };
  return { status: 'ready', value: String(roundFormulaResult(result)) };
}

/**
 * 関係性の端点（アノテーションIDまたはグループID）の値を解決する
 */
async function resolveEndpointValue(
  id: RelationalEndpointID,
  address: AnnotationBaseAddress,
): Promise<Result<EndpointValueState>> {
  const annotInfo = await ensureAnnotationInfo(id as AnnotationID, address);
  if (annotInfo.ok) {
    const text = annotInfo.value.context.text;
    return Success(text === undefined ? { status: 'pending' } : { status: 'ready', value: text });
  }
  if (!(annotInfo.error instanceof NotFoundError)) return annotInfo;

  const group = await annotationGroupService.getGroupRecord(id as AnnotationGroupID);
  if (!group.ok) return group;
  if (group.value.valueAggregation === undefined) return Success({ status: 'unresolvable' });

  return Success(
    await resolveGroupValue(
      group.value.memberIds,
      group.value.address,
      group.value.valueAggregation,
    ),
  );
}

/**
 * 指定した関係性一覧を検証する
 */
export async function checkRelational(
  r: RelationalWithAddress,
): Promise<Result<RelationalResponce>> {
  const srcState = await resolveEndpointValue(r.relational.srcID, r.srcAddress);
  if (!srcState.ok) return srcState;
  const targetState = await resolveEndpointValue(r.relational.targetID, r.targetAddress);
  if (!targetState.ok) return targetState;

  // どちらかが「読み込み中」の場合は検証を保留する（そのうち解決される可能性があるため）
  // （OCR結果が空文字列''になるケースは「読み込み済みだが内容が空」であり、これは未読み込みとは区別する）
  if (srcState.value.status === 'pending' || targetState.value.status === 'pending') {
    return Failure(new Error('An annotation content is not loaded yet'));
  }

  const srcVal = srcState.value.status === 'ready' ? srcState.value.value : '';
  const targetVal = targetState.value.status === 'ready' ? targetState.value.value : '';

  // 'unresolvable'（グループの値算出方法が未設定）を含む場合、'equal'ルールの検証は
  // 常にNGとして確定させる（'link'ルールは値を使わないため未設定でも通常通り成立する）
  const hasUnresolvable =
    srcState.value.status === 'unresolvable' || targetState.value.status === 'unresolvable';

  // 緩和ルールのアプリ設定側フォールバックは、src側アノテーションが属するコンテナの
  // コンテナ設定（`.kumihimo/settings.json`）を基準にする（同一コンテナを開く誰にとっても
  // 同じ検証結果になるようにするため、ブラウザローカルなアプリ設定は使わない）
  const checkedRule = await validRelational(
    r.relational,
    srcVal,
    targetVal,
    r.srcAddress.cID,
    hasUnresolvable,
  );

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
  const srcAddress = await resolveEndpointAddress(newRelational.srcID);
  if (!srcAddress.ok) return srcAddress;
  const targetAddress = await resolveEndpointAddress(newRelational.targetID);
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
 * 指定した端点（アノテーションまたはグループ）に紐づく関係性を仮フラグ付きでをすべて削除する
 */
export function removeRelationals(srcID: RelationalEndpointID): Promise<Result<void>> {
  return relationalRepository.softRemoveRelationalsBySrcID(srcID);
}

/**
 * srcID・targetIDが一致する1本の関係性のみを削除する（リンクの変更・個別削除用）
 */
export function removeRelationalEdge(
  srcID: RelationalEndpointID,
  targetID: RelationalEndpointID,
): Promise<Result<void>> {
  return relationalRepository.softRemoveRelationalEdge(srcID, targetID);
}

/**
 * 指定した端点（アノテーションまたはグループ）がsrc・target問わずどちらかの側で関わる
 * 関係性をすべて削除する
 *
 * アノテーション・グループ自体が削除された際、紐づく関係性を孤立させないためのクリーンアップ用
 */
export function removeRelationalsForAnnotation(id: RelationalEndpointID): Promise<Result<void>> {
  return relationalRepository.softRemoveRelationalsByAnnotationID(id);
}

/**
 * 端点（アノテーションまたはグループ）のIDから、それが属するファイル情報を解決する
 *
 * 関係性は別コンテナの端点同士でも定義できるため、対象コンテナが
 * まだ読み込まれていない場合はcontainerService.loadContainerで読み込む
 */
export async function resolveAnnotationFile(
  id: RelationalEndpointID,
): Promise<Result<ContainerElementFile>> {
  const address = await resolveEndpointAddress(id);
  if (!address.ok) return address;

  return resolveFileByAddress(address.value);
}

/**
 * 端点（アノテーションまたはグループ）のIDから、それが存在するページ番号を解決する
 *
 * 「対になるアノテーション」の文書を開く際、先頭ページではなく実際のページへ遷移させるために使う。
 * グループの場合はネストが無いため、先頭メンバーのページ番号を代表値として返す
 */
export async function getAnnotationPageNumber(id: RelationalEndpointID): Promise<Result<number>> {
  const address = await resolveEndpointAddress(id);
  if (!address.ok) return address;

  const info = await ensureAnnotationInfo(id as AnnotationID, address.value);
  if (info.ok) return Success(info.value.style.pageNumber);
  if (!(info.error instanceof NotFoundError)) return info;

  const group = await annotationGroupService.getGroupRecord(id as AnnotationGroupID);
  if (!group.ok) return group;
  const firstMemberId = group.value.memberIds[0];
  if (firstMemberId === undefined) return Failure(new NotFoundError('Group has no members'));

  const memberInfo = await ensureAnnotationInfo(firstMemberId, group.value.address);
  if (!memberInfo.ok) return memberInfo;
  return Success(memberInfo.value.style.pageNumber);
}

/**
 * 関係性の端点（アノテーションまたはグループ）の周辺プレビュー画像を取得する
 *
 * アノテーションの場合は通常通り単体の周辺プレビューを返す。グループの場合は、
 * 代表ページ（先頭メンバーのページ。getAnnotationPageNumberと同じ方針）上の各メンバーを
 * まとめて強調表示したプレビューを生成する（他ページのメンバーは対象外とする）。
 *
 * `src/repositories/document/pdf`（pdf.js経由で重い）は、このファイルの他の関数が
 * 動作上依存しない実行時にのみ読み込むよう動的importにする。relational.test.tsは
 * 単体テストのために`annotationGroup`等の重い依存を意図的にモック化しているが、
 * 静的importにすると常にpdf.jsの実体が読み込まれてしまいそのモック化の意味が失われるため
 */
export async function getRelationalEndpointPreviewImage(
  id: RelationalEndpointID,
  scale = 2,
): Promise<Result<string>> {
  const { extractAnnotationContextPreview, extractGroupContextPreview } =
    await import('src/repositories/document/pdf');

  const address = await resolveEndpointAddress(id);
  if (!address.ok) return address;

  const fileSrc = await containerService.loadFileAsDocumentSource(
    address.value.cID,
    address.value.filePath,
  );
  if (!fileSrc.ok) return fileSrc;
  const fileIdentity = { containerID: address.value.cID, path: address.value.filePath };

  const info = await ensureAnnotationInfo(id as AnnotationID, address.value);
  if (info.ok) {
    return extractAnnotationContextPreview(fileIdentity, fileSrc.value, info.value.style, scale);
  }
  if (!(info.error instanceof NotFoundError)) return info;

  const group = await annotationGroupService.getGroupRecord(id as AnnotationGroupID);
  if (!group.ok) return group;

  const memberInfos = await Promise.all(
    group.value.memberIds.map((memberId) => ensureAnnotationInfo(memberId, group.value.address)),
  );
  const memberStyles = memberInfos.flatMap((r) => (r.ok ? [r.value.style] : []));
  const representativePage = memberStyles[0]?.pageNumber;
  if (representativePage === undefined) {
    return Failure(new NotFoundError('No resolvable group members'));
  }
  const samePageStyles = memberStyles.filter((s) => s.pageNumber === representativePage);

  return extractGroupContextPreview(fileIdentity, fileSrc.value, samePageStyles, scale);
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
 * コンテナ単位の緩和ルールのキャッシュ
 *
 * 1ファイル分の関係性検証（`relationalStore.refreshFile`）は多数の`equal`ルールを
 * まとめて検証するため、`rule.relaxation`が指定されていない全ての関係性が同じコンテナの
 * 設定ファイルを毎回読みに行くと、無駄なファイル読み込みが繰り返されてしまう。
 * 一度読み込んだ内容はコンテナIDごとにここへ保持し、設定が更新された際は
 * `invalidateContainerRelaxationCache`で破棄する
 */
const containerRelaxationCache = new Map<ContainerID, RelaxationOptions>();

/**
 * コンテナ単位の緩和ルールのキャッシュを破棄する
 *
 * コンテナ設定（`.kumihimo/settings.json`）を更新した直後に呼び出し、古い緩和ルールが
 * それ以降の検証に使われ続けないようにする
 */
export function invalidateContainerRelaxationCache(cID: ContainerID): void {
  containerRelaxationCache.delete(cID);
}

/**
 * 等値検証で使う緩和ルールを決定する
 *
 * アノテーション別設定（`rule.relaxation`）がある場合はコンテナ設定を完全に無視して
 * それだけを使う（合成ではなく完全上書き）。無い場合のみ、コンテナルートの設定ファイル
 * （`.kumihimo/settings.json`）にフォールバックする。ブラウザ単位のアプリ設定
 * （IndexedDB）は使わない——同一コンテナを開いた誰にとっても検証結果が同じになるようにするため。
 * フォールバック先の設定はコンテナごとにキャッシュし、同一バッチ内での重複読み込みを避ける
 */
async function resolveRelaxationOptions(
  rule: Extract<RelationalRule, { type: 'equal' }>,
  cID: ContainerID,
): Promise<RelaxationOptions> {
  if (rule.relaxation !== undefined) return rule.relaxation;

  const cached = containerRelaxationCache.get(cID);
  if (cached !== undefined) return cached;

  const settingsRes = await containerConfigService.getContainerSettingsFile(cID);
  const relaxation = settingsRes.ok
    ? settingsRes.value.relationalRelaxation
    : DEFAULT_RELAXATION_OPTIONS;

  if (settingsRes.ok) containerRelaxationCache.set(cID, relaxation);
  return relaxation;
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
  return result === undefined ? rawText : String(roundFormulaResult(result));
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
  cID: ContainerID,
  hasUnresolvable: boolean,
): Promise<RelationalResponce> {
  let isOK = true;
  switch (relational.rule.type) {
    case 'link':
      break;
    case 'equal': {
      if (hasUnresolvable) {
        // グループの値算出方法が未設定などで一方の値が確定しない場合、常にNGとして扱う
        isOK = false;
        break;
      }
      const rule = relational.rule;
      const relaxation = await resolveRelaxationOptions(rule, cID);
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
