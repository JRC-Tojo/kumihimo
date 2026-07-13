import type { ContainerElementFile } from 'src/models/container';
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
 */
export async function loadConfig(file: ContainerElementFile): Promise<Result<DocumentConfigFile>> {
  // 設定ファイルの読み込み
  const configFile = await containerConfigService.getDocumentConfigFile(file.containerID, file);
  if (!configFile.ok) return configFile;

  // ファイルハッシュの確認
  const fileSrc = await containerService.loadFileAsDocumentSource(file.containerID, file.path);
  if (!fileSrc.ok) return fileSrc;
  const fileHash = await calcBase64Hash(fileSrc.value);
  if (fileHash.ok && configFile.value.fileHash !== fileHash.value)
    return Failure(new Error('This file is updated (checksum is not same)'));

  // 返す前にConfigから読み取ったAnnotation情報をAnnotDBに保存する
  const annotInfos = Object.values(configFile.value.annots);
  const registRes = await annotationService.registerAnnotationInfo(annotInfos, file);
  if (!registRes.ok) return registRes;

  // 更新版情報を返す
  return configFile;
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
