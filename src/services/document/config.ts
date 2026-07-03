import type { ContainerElementFile } from 'src/models/container';
import type { DocumentSource } from 'src/models/document/common';
import { CONFIG_FILE_EXTS } from 'src/models/document/common';
import { Failure, Success, type Result } from 'src/models/error/result';
import type { DocumentConfigFile } from 'src/models/relational/fileSchema';
import * as containerService from 'src/services/container/main';
import * as containerConfigService from 'src/services/container/config';
import * as relationalService from 'src/services/document/relational';
import * as annotationService from 'src/services/document/annotation';
import { filterAndExcludeDuplicateNames, Path } from 'src/utils/binary/path';
import { trackPdfAnnotation } from 'src/utils/tracker/trackPdfAnnot';
import { fromEntries } from 'src/utils/obj/obj';
import { calcBase64Hash } from 'src/utils/binary/base64';
import type { AnnotationStyle } from 'src/models/document/pdf';

/**
 * 指定したファイルに紐づく本システムの設定ファイルを読み込む
 */
export async function loadConfig(file: ContainerElementFile): Promise<Result<DocumentConfigFile>> {
  // 設定ファイルの読み込み
  const configFile = await containerConfigService.getDocumentConfigFile(file.containerID, file);
  if (!configFile.ok) return configFile;

  // ファイルハッシュの確認
  const fileSrc = await containerService.loadFileAsDocumentSource(file.containerID, file.path);
  if (!fileSrc.ok) return fileSrc;
  const fileHash = await calcBase64Hash(fileSrc.value);
  if (configFile.value.fileHash !== fileHash)
    return Failure(new Error('This file is updateded (checksum is not same)'));

  // 返す前にConfigから読み取ったAnnotation情報をAnnotDBに保存する
  const annotInfos = Object.values(configFile.value.annots);
  const registRes = await annotationService.registerAnnotationInfo(annotInfos, file);
  if (!registRes.ok) return registRes;

  // 更新版情報を返す
  return configFile;
}

/**
 * ファイルと同一階層に存在する、依存先のファイルが見つからない（＝浮いている）設定ファイルパス一覧
 */
export function getFloatingConfigPaths(file: ContainerElementFile): Promise<Result<string[]>> {
  return new Promise((resolve) => {
    const container = containerService.getContainer(file.containerID);
    if (!container.ok) return container;
    if (!('elements' in container.value)) return Success([]);

    const elemPaths = Object.values(container.value.elements).map((e) => e.path);
    const parentPath = new Path(file.path).parent().path;
    const currentDirPaths = elemPaths.filter((ep) => ep.startsWith(parentPath));
    const filteredPaths = filterAndExcludeDuplicateNames(currentDirPaths, CONFIG_FILE_EXTS);

    resolve(Success(filteredPaths));
  });
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
  const annotInfos = await annotationService.saveAnnotaionInfo();
  if (!annotInfos.ok) return annotInfos;

  // 関係性情報を取得する
  const relationas = await relationalService.saveRelationals(file);
  if (!relationas.ok) return relationas;

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
    relationas.value,
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
  if (loadedConf.value.fileHash === newHash) return loadedConf;

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
  loadedConf.value.fileHash = newHash;
  loadedConf.value.annots = fromEntries(
    newAnnotInfo.filter((info) => info.ok).map((info) => [info.value.style.id, info.value]),
  );

  return loadedConf;
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
