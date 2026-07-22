/**
 * WASM呼び出し前に、`doc.*`系ホストAPIが同期返却できるよう必要な文書情報を先読みする
 *
 * WASMのホスト関数は同期返却しかできないため、非同期の取得処理はすべて呼び出し前に
 * 完了させておく必要がある。`requiredHostApis`に含まれないAPIに対応するデータは
 * 取得しない（不要な処理を避けるとともに、最小権限の思想と合わせる）
 */
import type { ContainerElementFile } from 'src/models/container';
import type { PluginManifest, PluginHostApiName } from 'src/models/plugin/manifest';
import type { AnnotationInfo } from 'src/models/relational/fileSchema';
import type { Result } from 'src/models/error/result';
import { Success } from 'src/models/error/result';
import * as containerService from 'src/services/container/main';
import * as annotationService from 'src/services/document/annotation';
import * as pdfRepo from 'src/repositories/document/pdf';

export interface PluginExecutionContext {
  targetFile: ContainerElementFile;
  // エントリポイント呼び出し時に先頭引数として渡すシステムコンテキスト
  pageCount: number;
  representativePageSize: { width: number; height: number };
  // doc.*系ホストAPI向けの先読みデータ
  metadataJson: string;
  pageSizes: Map<number, { width: number; height: number }>;
  pageTextBlocksJson: Map<number, string>;
  pageImages: Map<number, string>;
  existingAnnotations: AnnotationInfo[];
}

function requestsApi(manifest: PluginManifest, api: PluginHostApiName): boolean {
  return manifest.requiredHostApis.includes(api);
}

export async function buildExecutionContext(
  manifest: PluginManifest,
  targetFile: ContainerElementFile,
): Promise<Result<PluginExecutionContext>> {
  const srcRes = await containerService.loadFileAsDocumentSource(
    targetFile.containerID,
    targetFile.path,
  );
  if (!srcRes.ok) return srcRes;
  const src = srcRes.value;

  const pageCountRes = await pdfRepo.getNumPages(src);
  if (!pageCountRes.ok) return pageCountRes;
  const pageCount = pageCountRes.value;

  // 代表ページサイズ（先頭ページ）。全ページが同一サイズであるという簡略化の前提を置く
  const repSizeRes = await pdfRepo.getPageSize(src, 1);
  if (!repSizeRes.ok) return repSizeRes;

  const containerRes = containerService.getContainer(targetFile.containerID);
  const containerName = containerRes.ok ? containerRes.value.name : '';

  const metadataJson = JSON.stringify({
    containerId: targetFile.containerID,
    containerName,
    filePath: targetFile.path,
    description: targetFile.description,
    genre: targetFile.genre,
    tags: targetFile.tags,
    pageCount,
  });

  const pageSizes = new Map<number, { width: number; height: number }>();
  if (requestsApi(manifest, 'doc.getPageSize')) {
    for (let page = 1; page <= pageCount; page++) {
      const res = await pdfRepo.getPageSize(src, page);
      if (res.ok) pageSizes.set(page, res.value);
    }
  }

  const pageTextBlocksJson = new Map<number, string>();
  if (requestsApi(manifest, 'doc.getPageTextBlocks')) {
    for (let page = 1; page <= pageCount; page++) {
      const res = await pdfRepo.extractTextBlocksByPage(src, page);
      if (res.ok) pageTextBlocksJson.set(page, JSON.stringify(res.value));
    }
  }

  // 既知の制約: 全ページを事前レンダリングするため、doc.getPageImageを要求するプラグインでは
  // ページ数の多い文書で起動が遅くなる。v1では簡潔さを優先し許容する
  const pageImages = new Map<number, string>();
  if (requestsApi(manifest, 'doc.getPageImage')) {
    for (let page = 1; page <= pageCount; page++) {
      const res = await pdfRepo.renderPageToCanvas(src, page, 1);
      if (res.ok) pageImages.set(page, res.value.toDataURL('image/png'));
    }
  }

  let existingAnnotations: AnnotationInfo[] = [];
  if (
    requestsApi(manifest, 'doc.getAnnotationsByFile') ||
    requestsApi(manifest, 'doc.getAnnotationIdsByTag')
  ) {
    const res = await annotationService.getAnnotationsByFile(targetFile);
    if (res.ok) existingAnnotations = res.value;
  }

  return Success({
    targetFile,
    pageCount,
    representativePageSize: repSizeRes.value,
    metadataJson,
    pageSizes,
    pageTextBlocksJson,
    pageImages,
    existingAnnotations,
  });
}
