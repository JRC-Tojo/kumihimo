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
import { Failure, Success } from 'src/models/error/result';
import * as containerService from 'src/services/container/main';
import * as annotationService from 'src/services/document/annotation';
import * as pdfRepo from 'src/repositories/document/pdf';
import { acquirePdfDocument } from 'src/repositories/document/pdfDocumentCache';

export interface PluginExecutionContext {
  // `ui.addFileField`宣言順に選択された対象文書。現状の`doc.*`/`plan.*`系ホストAPIは
  // 1件目（主対象ファイル）のみを操作する（§複数ファイル対応は将来のホストAPI拡張で行う）
  targetFiles: ContainerElementFile[];
  // エントリポイント呼び出し時に先頭引数として渡すシステムコンテキスト（主対象ファイルの値）
  pageCount: number;
  representativePageSize: { width: number; height: number };
  // doc.*系ホストAPI向けの先読みデータ（主対象ファイルの値）
  metadataJson: string;
  pageSizes: Map<number, { width: number; height: number }>;
  pageTextBlocksJson: Map<number, string>;
  pageImages: Map<number, string>;
  existingAnnotations: AnnotationInfo[];
}

function requestsApi(manifest: PluginManifest, api: PluginHostApiName): boolean {
  return manifest.requiredHostApis.includes(api);
}

/** `targetFiles`が空の場合の既定コンテキスト（`file`型フィールドを持たないプラグイン向け） */
function emptyContext(): PluginExecutionContext {
  return {
    targetFiles: [],
    pageCount: 0,
    representativePageSize: { width: 0, height: 0 },
    metadataJson: '{}',
    pageSizes: new Map(),
    pageTextBlocksJson: new Map(),
    pageImages: new Map(),
    existingAnnotations: [],
  };
}

/**
 * プラグイン実行に必要な文書情報を先読みする
 *
 * `targetFiles`の1件目（主対象ファイル）のPDFを`acquirePdfDocument`で1回だけ取得し、
 * 全ページのサイズ・テキスト・画像の先読みをそのインスタンスに対して行う
 * （ページごとに`loadPdfFromSrc64`し直すとページ数に比例して読み込みが繰り返され、
 * pdf.jsのWorker生成コストが増大するため）
 */
export async function buildExecutionContext(
  manifest: PluginManifest,
  targetFiles: ContainerElementFile[],
): Promise<Result<PluginExecutionContext>> {
  const primaryFile = targetFiles[0];
  if (!primaryFile) return Success(emptyContext());

  const srcRes = await containerService.loadFileAsDocumentSource(
    primaryFile.containerID,
    primaryFile.path,
  );
  if (!srcRes.ok) return srcRes;
  const src = srcRes.value;

  const acquiredRes = await acquirePdfDocument(primaryFile, src);
  if (!acquiredRes.ok) return Failure(acquiredRes.error);
  const { document: pdf, release } = acquiredRes.value;

  try {
    const pageCount = pdf.numPages;

    // 代表ページサイズ（先頭ページ）。全ページが同一サイズであるという簡略化の前提を置く
    const repSizeRes = await pdfRepo.getPageSizeFromDoc(pdf, 1);
    if (!repSizeRes.ok) return Failure(repSizeRes.error);

    const containerRes = containerService.getContainer(primaryFile.containerID);
    const containerName = containerRes.ok ? containerRes.value.name : '';

    const metadataJson = JSON.stringify({
      containerId: primaryFile.containerID,
      containerName,
      filePath: primaryFile.path,
      description: primaryFile.description,
      genre: primaryFile.genre,
      tags: primaryFile.tags,
      pageCount,
    });

    const pageSizes = new Map<number, { width: number; height: number }>();
    if (requestsApi(manifest, 'doc.getPageSize')) {
      for (let page = 1; page <= pageCount; page++) {
        const res = await pdfRepo.getPageSizeFromDoc(pdf, page);
        if (res.ok) pageSizes.set(page, res.value);
      }
    }

    const pageTextBlocksJson = new Map<number, string>();
    if (requestsApi(manifest, 'doc.getPageTextBlocks')) {
      for (let page = 1; page <= pageCount; page++) {
        const res = await pdfRepo.extractTextBlocksByPageFromDoc(pdf, page);
        if (res.ok) pageTextBlocksJson.set(page, JSON.stringify(res.value));
      }
    }

    // 既知の制約: 全ページを事前レンダリングするため、doc.getPageImageを要求するプラグインでは
    // ページ数の多い文書で起動が遅くなる。v1では簡潔さを優先し許容する
    const pageImages = new Map<number, string>();
    if (requestsApi(manifest, 'doc.getPageImage')) {
      for (let page = 1; page <= pageCount; page++) {
        const res = await pdfRepo.renderPageToCanvasFromDoc(pdf, page, 1);
        if (res.ok) pageImages.set(page, res.value.toDataURL('image/png'));
      }
    }

    let existingAnnotations: AnnotationInfo[] = [];
    if (
      requestsApi(manifest, 'doc.getAnnotationsByFile') ||
      requestsApi(manifest, 'doc.getAnnotationIdsByTag')
    ) {
      const res = await annotationService.getAnnotationsByFile(primaryFile);
      if (res.ok) existingAnnotations = res.value;
    }

    return Success({
      targetFiles,
      pageCount,
      representativePageSize: repSizeRes.value,
      metadataJson,
      pageSizes,
      pageTextBlocksJson,
      pageImages,
      existingAnnotations,
    });
  } finally {
    release();
  }
}
