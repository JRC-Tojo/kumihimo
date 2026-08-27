import type { ContainerElement, ContainerElementFile, RenamedEntry } from 'src/models/container';
import type { DocumentSource } from 'src/models/document/common';
import { CONFIG_FILE_EXTS } from 'src/models/document/common';
import { Failure, NotFoundError, Success, type Result } from 'src/models/error/result';
import type { DocumentConfigFile } from 'src/models/relational/fileSchema';
import { BookmarkID as BookmarkIDSchema } from 'src/models/relational/fileSchema';
import * as containerService from 'src/services/container/main';
import * as containerConfigService from 'src/services/container/config';
import * as relationalService from 'src/services/document/relational';
import * as annotationService from 'src/services/document/annotation';
import * as annotationGroupService from 'src/services/document/annotationGroup';
import * as pdfRepo from 'src/repositories/document/pdf';
import { Path } from 'src/utils/binary/path';
import { trackPdfAnnotation } from 'src/utils/tracker/trackPdfAnnot';
import { fromEntries } from 'src/utils/obj/obj';
import { calcBase64Hash } from 'src/utils/binary/base64';
import type { AnnotationStyle } from 'src/models/document/pdf';
import { invalidatePdfDocument } from 'src/repositories/document/pdfDocumentCache';
import { invalidateRenderCache } from 'src/repositories/document/renderCache';
import { fileKey } from 'src/utils/document/fileKey';
import { getSupportedDocumentKind } from 'src/utils/document/supportedTypes';
import { outlineEntriesToBookmarks } from 'src/utils/document/bookmarkTree';
import {
  createSerializedResource,
  type MutationOutcome,
} from 'src/utils/promise/serializedResource';

/**
 * `.kcfg`のハッシュ記録と実ファイルの内容が一致しない場合（＝アプリ外でファイルが更新された場合）に
 * `loadConfig`が返すエラー
 *
 * 通常の読み込み失敗（ファイルアクセスエラー等）と区別し、呼び出し側（フロントエンド）で
 * コンフリクト解決フローに分岐させるための専用のエラー型
 */
export class DocumentConfigConflictError extends Error {
  constructor() {
    super('This file is updated (checksum is not same)');
    this.name = 'DocumentConfigConflictError';
  }
}

/**
 * `saveConfig`専用: PDF本体の内容自体が変わった場合の書き込みに必要な追加情報
 *
 * 指定するとバックアップ作成・ハッシュの`newSrc`からの再計算を行う経路
 * （`containerConfigService.saveDocumentConfigs`）を使う。指定しない場合は`next.fileHash`を
 * そのまま書き込む単純な経路（`saveDocumentConfigFile`）を使う
 */
interface ConfigWriteMeta {
  oldSrc: DocumentSource;
  newSrc: DocumentSource;
}

/**
 * 指定したファイルに紐づく本システムの設定ファイルを、副作用なしで読み込む（実処理・排他制御なし）
 *
 * `.kcfg`がまだ存在しない場合（そのファイルに一度もアノテーションが保存されたことがない場合）は
 * エラーにせず、現在のファイル内容のハッシュを持つ空の設定として扱う。
 * 読み込み・パース自体の失敗（権限エラー・破損等）はアノテーション消失につながるため、
 * ファイル不存在（`NotFoundError`）と確認できた場合以外はそのままエラーとして返す。
 *
 * アノテーションDB同期・グループキャッシュ同期・アウトライン初回取り込みは行わない
 * （`loadConfigWithSideEffects`参照）。`updateConfig`の内部読み込みに使う：`updateConfig`は
 * これから新しい状態を書き込む前提であり、呼び出し時点でDBは既に（呼び出し元の別の処理により）
 * 正しい状態になっていることがあるため、ここで`.kcfg`の古いスナップショットをDBへ
 * 同期してしまうと、直後の正しい書き込みで上書きされるまでの間DBが一瞬巻き戻って見えてしまう
 * （自動保存が典型例：DB確定→`.kcfg`書き込みの間にDBを古い`.kcfg`で巻き戻してしまっていた）
 *
 * 直接呼び出さず、`loadConfig`（単純な読み込み）・`updateConfig`（読み込み→計算→書き込みの
 * トランザクション）のいずれかを経由すること。両者とも`configResource`によりファイル単位で
 * 直列化されるため、このアンロック版が並行して2重に走ることはない
 */
async function loadConfigRaw(file: ContainerElementFile): Promise<Result<DocumentConfigFile>> {
  // ファイルハッシュの算出（設定ファイルが無い場合の初期値としても使う）
  const fileSrc = await containerService.loadFileAsDocumentSource(file.containerID, file.path);
  if (!fileSrc.ok) return fileSrc;
  const fileHash = await calcBase64Hash(fileSrc.value);
  if (!fileHash.ok) return fileHash;

  // 設定ファイルの読み込み
  const configFileRes = await containerConfigService.getDocumentConfigFile(file.containerID, file);
  let configFile: DocumentConfigFile;
  if (configFileRes.ok) {
    configFile = configFileRes.value;
  } else if (configFileRes.error instanceof NotFoundError) {
    configFile = {
      fileHash: fileHash.value,
      annots: {},
      bookmarks: {},
      groups: {},
      outlineImported: false,
    };
  } else {
    return configFileRes;
  }

  // 設定ファイルが存在していた場合のみ、ファイル内容が更新されていないか確認する
  if (configFileRes.ok && configFile.fileHash !== fileHash.value) {
    return Failure(new DocumentConfigConflictError());
  }

  return Success(configFile);
}

/**
 * `loadConfigRaw`に加えて、公開`loadConfig`が必要とする副作用（アウトライン初回取り込み・
 * アノテーションDB同期・グループキャッシュ同期）を行う
 */
async function loadConfigWithSideEffects(
  file: ContainerElementFile,
): Promise<Result<DocumentConfigFile>> {
  const rawRes = await loadConfigRaw(file);
  if (!rawRes.ok) return rawRes;
  let configFile = rawRes.value;

  // PDFに元々埋め込まれているしおり（アウトライン）を、初回読み込み時のみ自動でブックマークに
  // 取り込む。取り込み済みフラグを永続化することで、以降は同じ文書を開いても重複登録しない
  if (!configFile.outlineImported && getSupportedDocumentKind(file.path) === 'pdf') {
    const fileSrc = await containerService.loadFileAsDocumentSource(file.containerID, file.path);
    if (!fileSrc.ok) return fileSrc;
    configFile = await importOutlineOnce(file, configFile, fileSrc.value);
  }

  // 返す前にConfigから読み取ったAnnotation情報をAnnotDBに保存する
  // （`.kcfg`に記録済みの確定データであるため、仮フラグは付けない＝isTemporary: false）。
  // ただし、まだ`.kcfg`に反映されていないローカルの編集・削除（isTemporary: true）がある注釈は、
  // この古いスナップショットで上書きしない（タブ切替による再マウントのたびに毎回この経路を通るため、
  // ここで無条件に上書きすると、直前の編集がblur等でDBへ書き込まれた直後でも巻き戻ってしまう）。
  // 仮登録IDの判定と登録を単一のDBトランザクションで行うことで、判定後・登録前に別の書き込みが
  // 割り込んで巻き戻ってしまう競合を防ぐ（`registerConfigAnnotationInfos`参照）
  const annotInfos = Object.values(configFile.annots);
  const registRes = await annotationService.registerConfigAnnotationInfos(file, annotInfos);
  if (!registRes.ok) return registRes;

  // グループはブックマーク同様DB経由の差分管理を行わないため、`.kcfg`の内容をそのまま
  // グローバルキャッシュ（関係性のアドレス解決に使う）へ同期する。
  // 既存の.kcfgにはこのフィールドが無いため、読み込み時は空のオブジェクトを既定値とする
  const groupSyncRes = await annotationGroupService.syncGroupCache(
    file,
    Object.values(configFile.groups ?? {}),
  );
  if (!groupSyncRes.ok) return groupSyncRes;

  // 更新版情報を返す
  return Success(configFile);
}

/**
 * PDFのしおり（アウトライン）を一度だけブックマークへ取り込む
 *
 * アウトラインの取得に失敗した場合（破損・パスワード付き等）は`outlineImported`を立てず
 * ベストエフォートで諦める（次回の`loadConfig`で再試行できるようにする）。
 * アウトラインが0件の場合も「確認済み」として`outlineImported`を立て、以降のPDF解析を省く
 */
async function importOutlineOnce(
  file: ContainerElementFile,
  configFile: DocumentConfigFile,
  fileSrc: DocumentSource,
): Promise<DocumentConfigFile> {
  const outlineRes = await pdfRepo.getOutline(fileSrc);
  if (!outlineRes.ok) return configFile;

  const importedBookmarks = outlineEntriesToBookmarks(outlineRes.value, () =>
    BookmarkIDSchema.parse(crypto.randomUUID()),
  );
  const mergedBookmarks = {
    ...configFile.bookmarks,
    ...fromEntries(importedBookmarks.map((b) => [b.id, b])),
  };

  const saveRes = await containerConfigService.saveDocumentConfigFile(
    file.containerID,
    file.path,
    Object.values(configFile.annots),
    configFile.fileHash,
    mergedBookmarks,
    configFile.groups,
    true,
  );
  if (!saveRes.ok) return configFile;

  return { ...configFile, bookmarks: mergedBookmarks, outlineImported: true };
}

/**
 * `.kcfg`への実際の書き込み（実処理・排他制御なし）
 *
 * `meta`（`oldSrc`/`newSrc`）を指定した場合はPDF本体の内容自体が変わった場合用の経路
 * （バックアップ作成・ハッシュ再計算）を、指定しない場合は`next.fileHash`をそのまま書き込む
 * 単純な経路を使う。書き込み成功後、DBのグループキャッシュも`next.groups`へ同期する
 * （`loadConfig`の読み込み時と対称的に、書き込み時も常にDBキャッシュとの整合を保つ）
 */
async function writeConfigUnlocked(
  file: ContainerElementFile,
  next: DocumentConfigFile,
  meta: ConfigWriteMeta | undefined,
): Promise<Result<void>> {
  const saveRes = meta
    ? await containerConfigService.saveDocumentConfigs(
        file.containerID,
        file.path,
        meta.oldSrc,
        meta.newSrc,
        Object.values(next.annots),
        next.bookmarks,
        next.groups,
        next.outlineImported ?? false,
      )
    : await containerConfigService.saveDocumentConfigFile(
        file.containerID,
        file.path,
        Object.values(next.annots),
        next.fileHash,
        next.bookmarks,
        next.groups,
        next.outlineImported ?? false,
      );
  if (!saveRes.ok) return saveRes;

  return annotationGroupService.syncGroupCache(file, Object.values(next.groups));
}

/**
 * `.kcfg`を対象ファイルごとに直列化して読み書きするリソース
 *
 * 複数の独立した処理（グループ化・ブックマーク登録・自動保存等）が同じ`.kcfg`へ並行して
 * 読み込み→書き込みを行うと、後勝ちの書き込みが間の変更を消してしまう（lost update）。
 * このリソースを経由する限り、同一ファイルへの`loadConfig`/`updateConfig`呼び出しは
 * 自動的に直列化され、呼び出し元は排他制御の仕組みを一切意識する必要がない
 */
const configResource = createSerializedResource<
  ContainerElementFile,
  DocumentConfigFile,
  ConfigWriteMeta | undefined
>(fileKey, {
  read: loadConfigWithSideEffects,
  readForMutate: loadConfigRaw,
  write: writeConfigUnlocked,
});

/**
 * 指定したファイルに紐づく本システムの設定ファイルを読み込む
 *
 * 同一ファイルに対する他の`loadConfig`/`updateConfig`呼び出しと直列化されるため、
 * 進行中の書き込みの途中経過を読んでしまうことはない
 */
export async function loadConfig(file: ContainerElementFile): Promise<Result<DocumentConfigFile>> {
  return configResource.read(file);
}

/** `updateConfig`の`mutate`が返す、書き込む次の状態と呼び出し元へ返す結果の組 */
export type ConfigMutationOutcome<T> = MutationOutcome<DocumentConfigFile, T>;

/**
 * `.kcfg`に対する「読み込み→計算→書き込み」をファイル単位で直列化された1トランザクションとして実行する
 *
 * 同一ファイルに対する呼び出しは常に1つずつ実行されるため、`mutate`が受け取る`current`は
 * 必ずその時点の最新状態であり、他の`updateConfig`/自動保存等との間でlost updateは起きない。
 * `mutate`はグループ等、DBキャッシュとの同期が必要な副作用を自分で行う必要はない
 * （書き込み成功後、このヘルパーがグループキャッシュを`next.groups`へ同期する）。
 * `sourceForBackup`を指定すると、PDF本体の内容自体が変わった場合用にバックアップを作成し
 * ハッシュを`newSrc`から再計算する経路（`saveConfig`専用）を使う
 */
export async function updateConfig<T>(
  file: ContainerElementFile,
  mutate: (
    current: DocumentConfigFile,
  ) => Promise<Result<ConfigMutationOutcome<T>>> | Result<ConfigMutationOutcome<T>>,
  sourceForBackup?: { oldSrc: DocumentSource; newSrc: DocumentSource },
): Promise<Result<T>> {
  return configResource.mutate(file, mutate, sourceForBackup);
}

/**
 * コンフリクト解決時、外部で更新された実ファイルの内容を正としてアノテーションDBと`.kcfg`を更新する
 *
 * `updateConfigForNewDoc`で再追跡した（または位置追跡できず現状のまま採用する）設定内容を
 * 確定として書き込む。内容そのものの変更ではなく外部変更の追認であるため、
 * `saveConfig`と異なりバックアップの作成は行わない。
 *
 * `updateConfig`ではなく`configResource.write`を使う点に注意：`updateConfig`の内部読み込みは
 * 既存`.kcfg`のfileHashと実ファイルの現在のハッシュが一致することを前提条件として検証するが、
 * ここはまさにその不一致（コンフリクト）をユーザーの明示的な操作で受け入れる経路であるため、
 * そのチェック自体を通ると常に失敗してしまう。`write`はその事前条件チェックを行わずに書き込む
 * （ファイル単位の直列化自体は`updateConfig`と同じ仕組みで維持される）
 */
export async function acceptExternalConfig(
  file: ContainerElementFile,
  config: DocumentConfigFile,
): Promise<Result<void>> {
  const annotInfos = Object.values(config.annots);

  const configRes = await configResource.write(
    file,
    () => Success({ next: config, result: undefined }),
    undefined,
  );
  if (!configRes.ok) return configRes;

  // 実ファイルの内容がアプリ外で更新されたことを受け入れるため、キャッシュ済みのPDFDocumentProxyが
  // あれば破棄する（次回の読み込みで新しい内容を反映させる）
  invalidatePdfDocument(file);
  // レンダリング結果キャッシュ（`renderCache.ts`）も同様に、古い内容の画像を再利用しないよう破棄する
  invalidateRenderCache(fileKey(file));

  return annotationService.registerAnnotationInfo(annotInfos, file, false);
}

/**
 * ファイルと同一階層に存在する、依存先のファイルが見つからない（＝浮いている）設定ファイルパス一覧
 *
 * 設定ファイルは対応する文書ファイルと同名で保存される仕様のため、
 * 対応する文書ファイルが見つからない設定ファイルのみを抽出する
 */
export function getFloatingConfigPaths(file: ContainerElementFile): Result<string[]> {
  const container = containerService.getContainer(file.containerID);
  if (!container.ok) return container;
  if (!('elements' in container.value)) return Success([]);

  const elemPaths = Object.values(container.value.elements).map((e) => e.path);
  const filePath = new Path(file.path);
  const parentPath = filePath.parent();

  // 親ディレクトリの直下にあるすべてのファイルを取得
  const siblingPaths = elemPaths.filter((ep) => {
    const elemPath = new Path(ep);
    const relative = parentPath.relativeto(elemPath).path;
    // スラッシュを含まない（= 同一階層）のファイルのみ
    return !relative.includes('/');
  });

  // 同一階層の設定ファイルについて、対応する文書ファイルが存在するか確認
  const floatingConfigPaths = siblingPaths
    .filter((siblingPath) => {
      const siblingPathObj = new Path(siblingPath);
      return siblingPathObj.extname() === CONFIG_FILE_EXTS;
    })
    .filter((configPath) => {
      // 設定ファイルと同名のファイル（拡張子なし）を探す
      const configFileName = new Path(configPath).stemname();
      const relatedFile = siblingPaths.find(
        (sibling) => new Path(sibling).stemname() === configFileName && sibling !== configPath,
      );
      // 対応するファイルが見つからないものを浮いていると判定
      return !relatedFile;
    });

  return Success(floatingConfigPaths);
}

/**
 * アノテーション情報と関係性情報を設定ファイルに保存する
 *
 * アノテーションDB、関係性DBで付けた仮フラグを当該ファイルについては除去する
 */
export async function saveConfig(
  file: ContainerElementFile,
  oldSrc: DocumentSource,
  newSrc: DocumentSource,
): Promise<Result<void>> {
  // 仮登録中のアノテーション・関係性を確定する（isTemporaryフラグの解除。以降は未保存扱いされない）
  const commitAnnotRes = await annotationService.saveAnnotationInfo(file);
  if (!commitAnnotRes.ok) return commitAnnotRes;
  const commitRelRes = await relationalService.saveRelationals(file);
  if (!commitRelRes.ok) return commitRelRes;

  // `.kcfg`・関係性キャッシュへ書き込む内容は、現在有効な（削除されていない）全件を取得し直す。
  // saveAnnotationInfo/saveRelationalsの戻り値は今回のセッションで確定した差分のみのため、
  // それをそのまま書き込むと、今回変更していない既存のアノテーション・関係性を消してしまう
  const annotInfos = await annotationService.getAnnotationsByFile(file);
  if (!annotInfos.ok) return annotInfos;
  const rsWithAdrs = await relationalService.getRelationalsInvolvingFile(file);
  if (!rsWithAdrs.ok) return rsWithAdrs;

  // ブックマーク・グループ・しおり取り込み済みフラグはアノテーションと異なりDB経由の差分管理を
  // 行わないため、上書きで消えないよう`current`（updateConfigが直列化して読み込んだ最新状態）から
  // そのまま引き継ぐ。annotsのみ、今取得し直した全件で置き換える
  const annotSavedRes = await updateConfig(
    file,
    (current) =>
      Success({
        next: { ...current, annots: fromEntries(annotInfos.value.map((a) => [a.style.id, a])) },
        result: undefined,
      }),
    { oldSrc, newSrc },
  );
  if (!annotSavedRes.ok) return annotSavedRes;
  const relationalSavedRes = await containerConfigService.updateRelationalFile(
    file.containerID,
    file.path,
    rsWithAdrs.value,
  );
  if (!relationalSavedRes.ok) return relationalSavedRes;

  return Success();
}

/**
 * 「保存せず閉じる」選択時、このファイルについて仮登録されたアノテーション・関係性を破棄し、
 * 最後に保存された状態（実ファイルの`.kcfg`・関係性キャッシュの内容）へ戻す
 *
 * アノテーションDBの当該ファイル分の記録を一旦すべて削除したうえで`.kcfg`から読み直し、
 * 関係性DBも同様にコンテナの関係性キャッシュから当該ファイルが関わる分だけを読み直す。
 * 新規追加・削除いずれも区別なく巻き戻せるため、以降`hasUnsavedChangesByFile`は
 * 再びfalseを返すようになる
 */
export async function discardUnsavedChanges(file: ContainerElementFile): Promise<Result<void>> {
  const clearRes = await annotationService.clearAnnotationsForFile(file);
  if (!clearRes.ok) return clearRes;

  const reloadRes = await loadConfig(file);
  if (!reloadRes.ok) return reloadRes;

  return relationalService.discardUnsavedRelationalsInvolvingFile(file);
}

/**
 * 既存文書が新規文書で更新されたときにConfig情報も更新する
 */
export async function updateConfigForNewDoc(
  file: ContainerElementFile,
  confFilePath?: string,
): Promise<Result<DocumentConfigFile>> {
  // 文書設定メタ情報を取得
  let loadedConf;
  if (confFilePath) {
    loadedConf = await containerConfigService.getDocumentConfigFile(file.containerID, confFilePath);
  } else {
    loadedConf = await containerConfigService.getDocumentConfigFile(file.containerID, file);
  }
  if (!loadedConf.ok) return loadedConf;

  // ファイルハッシュの計算
  const newSrc = await containerService.loadFileAsDocumentSource(file.containerID, file.path);
  if (!newSrc.ok) return newSrc;
  const newHash = await calcBase64Hash(newSrc.value);
  if (!newHash.ok) return newHash;
  if (loadedConf.value.fileHash === newHash.value) return loadedConf;

  // アノテーションの更新（位置・文書内容）
  const oldSrc = await containerConfigService.getBackupSrc(
    file.containerID,
    loadedConf.value.fileHash,
  );
  if (!oldSrc.ok) return oldSrc;
  const newAnnotStyle = await trackAnnotation(
    file,
    oldSrc.value,
    newSrc.value,
    Object.values(loadedConf.value.annots).map((a) => a.style),
  );
  if (!newAnnotStyle.ok) return newAnnotStyle;

  // 更新位置でのアノテーション情報を取得する (取得時にDBにも保存する)
  const newAnnotInfo = await Promise.all(
    newAnnotStyle.value.map((style) => annotationService.registerAnnotationStyle(file, style)),
  );

  // マージする
  loadedConf.value.fileHash = newHash.value;
  loadedConf.value.annots = fromEntries(
    newAnnotInfo.filter((info) => info.ok).map((info) => [info.value.style.id, info.value]),
  );

  return loadedConf;
}

/**
 * ファイル削除時に、対応する`.kcfg`サイドカー設定ファイルが存在すれば削除する（ベストエフォート）
 *
 * サイドカーが存在しない場合の削除失敗も含め、本体ファイルの削除自体は成功として扱いたいため、
 * ここでのエラーは呼び出し元に伝播させずログのみに留める
 */
export async function deleteConfigForFile(file: ContainerElementFile): Promise<void> {
  const sidecarPath = containerConfigService.getConfigPath(file.path);
  const sidecarElement: ContainerElementFile = { ...file, path: sidecarPath };

  const deleteRes = await containerService.deleteFile(file.containerID, sidecarElement);
  if (!deleteRes.ok) {
    console.warn('Failed to delete sidecar config file (best-effort):', deleteRes.error);
  }
}

/**
 * ファイル・フォルダのパス変更（リネーム・移動）を行う
 *
 * 実データのパス変更に加えて、対応する`.kcfg`サイドカー設定ファイル、コンテナルートの
 * 関係性キャッシュファイル（`.kumihimo/relational.json`）、読み込み中のアノテーション/関係性DBの
 * ファイルパス参照もあわせて更新し、リネームによって整合性が崩れないようにする
 *
 * 戻り値は旧パスを保持した`RenamedEntry[]`とする（呼び出し側でPiniaストア等の
 * フロントエンド状態が保持する旧パス参照を新パスへ追従させるために必要なため）
 */
export async function renamePath(
  elem: ContainerElement,
  newPath: string,
): Promise<Result<RenamedEntry[]>> {
  const cID = elem.containerID;

  // Fileの場合、対応する.kcfgサイドカーが存在するかをリネーム前に確認しておく
  const containerBefore = containerService.getContainer(cID);
  if (!containerBefore.ok) return containerBefore;
  const elementsBefore = 'elements' in containerBefore.value ? containerBefore.value.elements : {};

  // 1. 本体（Folderの場合は配下も含む）のリネーム
  const mainRenameRes = await containerService.renamePath(cID, elem, newPath);
  if (!mainRenameRes.ok) return mainRenameRes;

  const allRenamed = [...mainRenameRes.value];

  // 2. リネームされた各Fileについて、対応する.kcfgサイドカーがあれば追従させる
  const renamedFiles = mainRenameRes.value.filter((r) => r.element.type === 'File');
  for (const renamedFile of renamedFiles) {
    const oldSidecarPath = containerConfigService.getConfigPath(renamedFile.oldPath);
    const sidecarElem = elementsBefore[oldSidecarPath];
    if (sidecarElem === undefined) continue;

    const newSidecarPath = containerConfigService.getConfigPath(renamedFile.element.path);
    const sidecarRenameRes = await containerService.renamePath(cID, sidecarElem, newSidecarPath);
    if (!sidecarRenameRes.ok) return sidecarRenameRes;
    allRenamed.push(...sidecarRenameRes.value);
  }

  // 3. コンテナルートの関係性キャッシュ・読み込み中DBのファイルパス参照を更新する
  //    （サイドカー自体は関係性の参照先にならないため、pathMapには含めない）
  const pathMap: Record<string, string> = {};
  renamedFiles.forEach((r) => {
    pathMap[r.oldPath] = r.element.path;
  });

  if (Object.keys(pathMap).length > 0) {
    const remapCacheRes = await containerConfigService.remapRelationalFilePaths(cID, pathMap);
    if (!remapCacheRes.ok) return remapCacheRes;

    for (const [oldPath, newPathStr] of Object.entries(pathMap)) {
      const annotRemapRes = await annotationService.remapFilePath(cID, oldPath, newPathStr);
      if (!annotRemapRes.ok) return annotRemapRes;
      const groupRemapRes = await annotationGroupService.remapFilePath(cID, oldPath, newPathStr);
      if (!groupRemapRes.ok) return groupRemapRes;
      const relRemapRes = await relationalService.remapFilePath(cID, oldPath, newPathStr);
      if (!relRemapRes.ok) return relRemapRes;
    }
  }

  return Success(allRenamed);
}

/**
 * ファイル・フォルダを別のフォルダ配下へ移動する
 *
 * 内部的には`renamePath`（移動先フォルダ + 元のbasename）として扱う
 */
export function moveElement(
  elem: ContainerElement,
  newParentPath: string,
): Promise<Result<RenamedEntry[]>> {
  const basename = new Path(elem.path).basename();
  const newPath = new Path(newParentPath).child(basename).path;
  return renamePath(elem, newPath);
}

/**
 * 古いアノテーションを新文書で追跡する
 */
async function trackAnnotation(
  file: ContainerElementFile,
  oldFileSrc: DocumentSource,
  newFileSrc: DocumentSource,
  annotInfo: AnnotationStyle[],
): Promise<Result<AnnotationStyle[]>> {
  const pathExts = new Path(file.path).extname();
  switch (pathExts) {
    case '.pdf':
      // TODO: 本当はプラグインとして処理を外部に出すべき
      // 現状はプラグインの設計が固まっていないため、このまま処理を内包する
      return trackPdfAnnotation(oldFileSrc, newFileSrc, annotInfo);
    default:
      return Failure(new Error(`Not supported this file type (${pathExts})`));
  }
}
