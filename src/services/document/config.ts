import type { ContainerElement, ContainerElementFile, RenamedEntry } from 'src/models/container';
import type { DocumentSource } from 'src/models/document/common';
import { CONFIG_FILE_EXTS } from 'src/models/document/common';
import { Failure, NotFoundError, Success, type Result } from 'src/models/error/result';
import type { DocumentConfigFile } from 'src/models/relational/fileSchema';
import * as containerService from 'src/services/container/main';
import * as containerConfigService from 'src/services/container/config';
import * as relationalService from 'src/services/document/relational';
import * as annotationService from 'src/services/document/annotation';
import { Path } from 'src/utils/binary/path';
import { trackPdfAnnotation } from 'src/utils/tracker/trackPdfAnnot';
import { fromEntries } from 'src/utils/obj/obj';
import { calcBase64Hash } from 'src/utils/binary/base64';
import type { AnnotationStyle } from 'src/models/document/pdf';
import { invalidatePdfDocument } from 'src/repositories/document/pdfDocumentCache';
import { invalidateRenderCache } from 'src/repositories/document/renderCache';
import { fileKey } from 'src/utils/document/fileKey';

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
 * 指定したファイルに紐づく本システムの設定ファイルを読み込む
 *
 * `.kcfg`がまだ存在しない場合（そのファイルに一度もアノテーションが保存されたことがない場合）は
 * エラーにせず、現在のファイル内容のハッシュを持つ空の設定として扱う。
 * 読み込み・パース自体の失敗（権限エラー・破損等）はアノテーション消失につながるため、
 * ファイル不存在（`NotFoundError`）と確認できた場合以外はそのままエラーとして返す
 */
export async function loadConfig(file: ContainerElementFile): Promise<Result<DocumentConfigFile>> {
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
    configFile = { fileHash: fileHash.value, annots: {} };
  } else {
    return configFileRes;
  }

  // 設定ファイルが存在していた場合のみ、ファイル内容が更新されていないか確認する
  if (configFileRes.ok && configFile.fileHash !== fileHash.value) {
    return Failure(new DocumentConfigConflictError());
  }

  // 返す前にConfigから読み取ったAnnotation情報をAnnotDBに保存する
  // （`.kcfg`に記録済みの確定データであるため、仮フラグは付けない＝isTemporary: false）
  const annotInfos = Object.values(configFile.annots);
  const registRes = await annotationService.registerAnnotationInfo(annotInfos, file, false);
  if (!registRes.ok) return registRes;

  // 更新版情報を返す
  return Success(configFile);
}

/**
 * コンフリクト解決時、外部で更新された実ファイルの内容を正としてアノテーションDBと`.kcfg`を更新する
 *
 * `updateConfigForNewDoc`で再追跡した（または位置追跡できず現状のまま採用する）設定内容を
 * 確定として書き込む。内容そのものの変更ではなく外部変更の追認であるため、
 * `saveConfig`と異なりバックアップの作成は行わない
 */
export async function acceptExternalConfig(
  file: ContainerElementFile,
  config: DocumentConfigFile,
): Promise<Result<void>> {
  const annotInfos = Object.values(config.annots);

  const saveRes = await containerConfigService.saveDocumentConfigFile(
    file.containerID,
    file.path,
    annotInfos,
    config.fileHash,
  );
  if (!saveRes.ok) return saveRes;

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

  // 取得した情報をマージして実ファイルに保存する
  const annotSavedRes = await containerConfigService.saveDocumentConfigs(
    file.containerID,
    file.path,
    oldSrc,
    newSrc,
    annotInfos.value,
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
