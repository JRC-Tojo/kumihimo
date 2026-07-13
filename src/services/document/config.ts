import type { ContainerElement, ContainerElementFile } from 'src/models/container';
import type { DocumentSource } from 'src/models/document/common';
import { CONFIG_FILE_EXTS } from 'src/models/document/common';
import { Failure, Success, type Result } from 'src/models/error/result';
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

/**
 * 指定したファイルに紐づく本システムの設定ファイルを読み込む
 *
 * `.rdcfg`がまだ存在しない場合（そのファイルに一度もアノテーションが保存されたことがない場合）は
 * エラーにせず、現在のファイル内容のハッシュを持つ空の設定として扱う
 */
export async function loadConfig(file: ContainerElementFile): Promise<Result<DocumentConfigFile>> {
  // ファイルハッシュの算出（設定ファイルが無い場合の初期値としても使う）
  const fileSrc = await containerService.loadFileAsDocumentSource(file.containerID, file.path);
  if (!fileSrc.ok) return fileSrc;
  const fileHash = await calcBase64Hash(fileSrc.value);
  if (!fileHash.ok) return fileHash;

  // 設定ファイルの読み込み
  const configFileRes = await containerConfigService.getDocumentConfigFile(file.containerID, file);
  const configFile: DocumentConfigFile = configFileRes.ok
    ? configFileRes.value
    : { fileHash: fileHash.value, annots: {} };

  // 設定ファイルが存在していた場合のみ、ファイル内容が更新されていないか確認する
  if (configFileRes.ok && configFile.fileHash !== fileHash.value) {
    return Failure(new Error('This file is updated (checksum is not same)'));
  }

  // 返す前にConfigから読み取ったAnnotation情報をAnnotDBに保存する
  const annotInfos = Object.values(configFile.annots);
  const registRes = await annotationService.registerAnnotationInfo(annotInfos, file);
  if (!registRes.ok) return registRes;

  // 更新版情報を返す
  return Success(configFile);
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
  // アノテーション情報をDBから取得する
  const annotInfos = await annotationService.saveAnnotationInfo(file);
  if (!annotInfos.ok) return annotInfos;

  // 関係性情報を取得する
  const rsWithAdrs = await relationalService.saveRelationals(file);
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
 * ファイル・フォルダのパス変更（リネーム・移動）を行う
 *
 * 実データのパス変更に加えて、対応する`.rdcfg`サイドカー設定ファイル、コンテナルートの
 * 関係性キャッシュファイル（`.rd/relational.json`）、読み込み中のアノテーション/関係性DBの
 * ファイルパス参照もあわせて更新し、リネームによって整合性が崩れないようにする
 */
export async function renamePath(
  elem: ContainerElement,
  newPath: string,
): Promise<Result<ContainerElement[]>> {
  const cID = elem.containerID;

  // Fileの場合、対応する.rdcfgサイドカーが存在するかをリネーム前に確認しておく
  const containerBefore = containerService.getContainer(cID);
  if (!containerBefore.ok) return containerBefore;
  const elementsBefore = 'elements' in containerBefore.value ? containerBefore.value.elements : {};

  // 1. 本体（Folderの場合は配下も含む）のリネーム
  const mainRenameRes = await containerService.renamePath(cID, elem, newPath);
  if (!mainRenameRes.ok) return mainRenameRes;

  const allRenamed = [...mainRenameRes.value];

  // 2. リネームされた各Fileについて、対応する.rdcfgサイドカーがあれば追従させる
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

  return Success(allRenamed.map((r) => r.element));
}

/**
 * ファイル・フォルダを別のフォルダ配下へ移動する
 *
 * 内部的には`renamePath`（移動先フォルダ + 元のbasename）として扱う
 */
export function moveElement(
  elem: ContainerElement,
  newParentPath: string,
): Promise<Result<ContainerElement[]>> {
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
