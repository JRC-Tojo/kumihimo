/**
 * WASM呼び出し前に、`doc.*`系ホストAPIが同期返却できるよう必要な文書情報を先読みする
 *
 * WASMのホスト関数は同期返却しかできないため、非同期の取得処理はすべて呼び出し前に
 * 完了させておく必要がある。`requiredHostApis`に含まれないAPIに対応するデータは
 * 取得しない（不要な処理を避けるとともに、最小権限の思想と合わせる）
 *
 * `ui.addFileField`で選択された対象文書は複数になりうるため、先読みデータは
 * `targetFiles`と同じ並び順の配列（`fileContexts`）として保持する。`doc.*`/
 * `plan.addAnnotation`系ホストAPIは`fileIndex`引数でこの配列内の1件を指定する
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

/** `targetFiles`内の1ファイルぶんの先読みデータ */
export interface PluginFileContext {
  pageCount: number;
  metadataJson: string;
  pageSizes: Map<number, { width: number; height: number }>;
  pageTextBlocksJson: Map<number, string>;
  pageImages: Map<number, string>;
  existingAnnotations: AnnotationInfo[];
}

export interface PluginExecutionContext {
  // `ui.addFileField`宣言順に選択された対象文書
  targetFiles: ContainerElementFile[];
  // targetFiles[i]に対応する先読みデータ（同じ添字で参照する）
  fileContexts: PluginFileContext[];
  // エントリポイント呼び出し時に先頭引数として渡すシステムコンテキスト（主対象ファイル＝
  // targetFiles[0]のページ1サイズ。単一文書プラグインの便宜のため維持している）
  representativePageSize: { width: number; height: number };
}

function requestsApi(manifest: PluginManifest, api: PluginHostApiName): boolean {
  return manifest.requiredHostApis.includes(api);
}

/** `targetFiles`が空の場合の既定コンテキスト（`file`型フィールドを持たないプラグイン向け） */
function emptyContext(): PluginExecutionContext {
  return {
    targetFiles: [],
    fileContexts: [],
    representativePageSize: { width: 0, height: 0 },
  };
}

/**
 * 1ファイルぶんの先読みデータを構築する
 *
 * PDFを`acquirePdfDocument`で1回だけ取得し、全ページのサイズ・テキスト・画像の先読みを
 * そのインスタンスに対して行う（ページごとに`loadPdfFromSrc64`し直すとページ数に比例して
 * 読み込みが繰り返され、pdf.jsのWorker生成コストが増大するため）
 */
async function buildFileContext(
  manifest: PluginManifest,
  file: ContainerElementFile,
): Promise<Result<PluginFileContext & { representativePageSize: { width: number; height: number } }>> {
  const srcRes = await containerService.loadFileAsDocumentSource(file.containerID, file.path);
  if (!srcRes.ok) return srcRes;
  const src = srcRes.value;

  const acquiredRes = await acquirePdfDocument(file, src);
  if (!acquiredRes.ok) return Failure(acquiredRes.error);
  const { document: pdf, release } = acquiredRes.value;

  try {
    const pageCount = pdf.numPages;

    // 代表ページサイズ（先頭ページ）。全ページが同一サイズであるという簡略化の前提を置く
    const repSizeRes = await pdfRepo.getPageSizeFromDoc(pdf, 1);
    if (!repSizeRes.ok) return Failure(repSizeRes.error);

    const containerRes = containerService.getContainer(file.containerID);
    const containerName = containerRes.ok ? containerRes.value.name : '';

    const metadataJson = JSON.stringify({
      containerId: file.containerID,
      containerName,
      filePath: file.path,
      description: file.description,
      genre: file.genre,
      tags: file.tags,
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
      requestsApi(manifest, 'doc.getAnnotationIdsByTag') ||
      requestsApi(manifest, 'plan.updateAnnotation') ||
      requestsApi(manifest, 'plan.removeAnnotation')
    ) {
      const res = await annotationService.getAnnotationsByFile(file);
      if (res.ok) existingAnnotations = res.value;
    }

    return Success({
      pageCount,
      metadataJson,
      pageSizes,
      pageTextBlocksJson,
      pageImages,
      existingAnnotations,
      representativePageSize: repSizeRes.value,
    });
  } finally {
    release();
  }
}

/**
 * プラグイン実行に必要な文書情報を先読みする
 *
 * `targetFiles`を順に処理し、`fileContexts`（同じ並び順）を組み立てる。いずれかの
 * ファイルの読み込みに失敗した場合は、部分的なコンテキストで実行を進めず全体を
 * `Failure`として返す
 */
export async function buildExecutionContext(
  manifest: PluginManifest,
  targetFiles: ContainerElementFile[],
): Promise<Result<PluginExecutionContext>> {
  if (targetFiles.length === 0) return Success(emptyContext());

  const fileContexts: PluginFileContext[] = [];
  let representativePageSize = { width: 0, height: 0 };

  for (let i = 0; i < targetFiles.length; i++) {
    const file = targetFiles[i];
    if (!file) continue;
    const res = await buildFileContext(manifest, file);
    if (!res.ok) return res;
    const { representativePageSize: fileRepSize, ...fileContext } = res.value;
    fileContexts.push(fileContext);
    if (i === 0) representativePageSize = fileRepSize;
  }

  return Success({ targetFiles, fileContexts, representativePageSize });
}
