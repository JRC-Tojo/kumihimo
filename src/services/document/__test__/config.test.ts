import { describe, expect, it, mock } from 'bun:test';
import type { ContainerElementFile, ContainerID } from 'src/models/container';
import type { Result } from 'src/models/error/result';
import { Failure, NotFoundError, Success } from 'src/models/error/result';
import type { BookmarkID, DocumentConfigFile } from 'src/models/relational/fileSchema';
import type { DocumentSource } from 'src/models/document/common';
import type { PdfOutlineEntry } from 'src/models/document/pdf';
import { calcBase64Hash } from 'src/utils/binary/base64';

/**
 * `loadConfig`のPDFしおり自動取り込みロジックのみを検証する。
 * 実際のストレージ・アノテーションDB・関係性DB・pdf.js/pdf-libを一切使わないよう、
 * 依存するサービス・リポジトリをすべてモック化する（`relational.test.ts`と同じ方針）
 */
const containerID = '00000000-0000-4000-8000-000000000000' as ContainerID;

function buildFile(path: string): ContainerElementFile {
  return {
    containerID,
    type: 'File',
    path,
    createdAt: new Date(),
    updatedAt: new Date(),
    description: '',
    genre: '',
    tags: [],
  };
}

const DOC_SRC = 'AAAA' as DocumentSource;

const loadFileAsDocumentSourceMock = mock((): Promise<Result<DocumentSource>> =>
  Promise.resolve(Success(DOC_SRC)),
);
void mock.module('src/services/container/main', () => ({
  loadFileAsDocumentSource: loadFileAsDocumentSourceMock,
}));

// 文書設定ファイル（.kcfg）のフィクスチャ。各テストの冒頭で書き換える
let documentConfigFileFixture: DocumentConfigFile | undefined;
const getDocumentConfigFileMock = mock((): Promise<Result<DocumentConfigFile>> =>
  Promise.resolve(
    documentConfigFileFixture !== undefined
      ? Success(documentConfigFileFixture)
      : Failure(new NotFoundError('not found')),
  ),
);
const saveDocumentConfigFileMock = mock(
  (
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    _cID: ContainerID,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    _filePath: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    _annotInfos: unknown[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    _fileHash: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    _bookmarks: unknown,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    _outlineImported: boolean,
  ): Promise<Result<void>> => Promise.resolve(Success()),
);
void mock.module('src/services/container/config', () => ({
  getDocumentConfigFile: getDocumentConfigFileMock,
  saveDocumentConfigFile: saveDocumentConfigFileMock,
}));

const registerAnnotationInfoMock = mock((): Promise<Result<void>> => Promise.resolve(Success()));
void mock.module('src/services/document/annotation', () => ({
  registerAnnotationInfo: registerAnnotationInfoMock,
}));

void mock.module('src/repositories/document/pdfDocumentCache', () => ({
  invalidatePdfDocument: () => {},
}));
void mock.module('src/repositories/document/renderCache', () => ({
  invalidateRenderCache: () => {},
}));

// PDFのしおり（アウトライン）取得のフィクスチャ。各テストの冒頭で書き換える
let outlineFixture: Result<PdfOutlineEntry[]> = Success([]);
const getOutlineMock = mock((): Promise<Result<PdfOutlineEntry[]>> =>
  Promise.resolve(outlineFixture),
);
void mock.module('src/repositories/document/pdf', () => ({
  getOutline: getOutlineMock,
}));

const { loadConfig } = await import('../config');

// フィクスチャのfileHashは、モックが返すDOC_SRCの実ハッシュ値と一致させる必要がある
// （loadConfigは不一致を「アプリ外でファイルが更新された」コンフリクトとして扱うため）
const docSrcHashRes = await calcBase64Hash(DOC_SRC);
if (!docSrcHashRes.ok) throw docSrcHashRes.error;
const DOC_SRC_HASH = docSrcHashRes.value;

function savedArgs(): { bookmarks: Record<string, unknown>; outlineImported: boolean } {
  const call = saveDocumentConfigFileMock.mock.calls.at(-1);
  if (!call) throw new Error('saveDocumentConfigFile was not called');
  return { bookmarks: call[4] as Record<string, unknown>, outlineImported: call[5] };
}

describe('loadConfig（PDFしおりの自動取り込み）', () => {
  it('outlineImported未設定のPDFは、初回読み込み時にしおりをブックマークとして取り込む', async () => {
    documentConfigFileFixture = {
      fileHash: DOC_SRC_HASH,
      annots: {},
      bookmarks: {},
      outlineImported: false,
    };
    outlineFixture = Success([
      { title: '第1章', level: 0, pageNumber: 1 },
      { title: '1.1', level: 1, pageNumber: 2 },
    ]);

    const res = await loadConfig(buildFile('doc.pdf'));
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    expect(res.value.outlineImported).toBeTrue();
    const titles = Object.values(res.value.bookmarks).map((b) => b.title);
    expect(titles.sort()).toEqual(['1.1', '第1章'].sort());

    const saved = savedArgs();
    expect(saved.outlineImported).toBeTrue();
    expect(Object.keys(saved.bookmarks).length).toBe(2);
  });

  it('outlineImportedが既にtrueの場合は再度取り込まない（getOutlineを呼ばない）', async () => {
    documentConfigFileFixture = {
      fileHash: DOC_SRC_HASH,
      annots: {},
      bookmarks: {},
      outlineImported: true,
    };
    getOutlineMock.mockClear();
    saveDocumentConfigFileMock.mockClear();

    const res = await loadConfig(buildFile('doc.pdf'));
    expect(res.ok).toBeTrue();
    expect(getOutlineMock).not.toHaveBeenCalled();
    expect(saveDocumentConfigFileMock).not.toHaveBeenCalled();
  });

  it('PDF以外の文書では取り込みを行わない（getOutlineを呼ばない）', async () => {
    documentConfigFileFixture = {
      fileHash: DOC_SRC_HASH,
      annots: {},
      bookmarks: {},
      outlineImported: false,
    };
    getOutlineMock.mockClear();

    const res = await loadConfig(buildFile('doc.txt'));
    expect(res.ok).toBeTrue();
    expect(getOutlineMock).not.toHaveBeenCalled();
  });

  it('しおりが0件の場合も取り込み済みとして記録する（毎回の解析を防ぐ）', async () => {
    documentConfigFileFixture = {
      fileHash: DOC_SRC_HASH,
      annots: {},
      bookmarks: {},
      outlineImported: false,
    };
    outlineFixture = Success([]);

    const res = await loadConfig(buildFile('doc.pdf'));
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.outlineImported).toBeTrue();
    expect(Object.keys(res.value.bookmarks).length).toBe(0);
  });

  it('しおりの取得に失敗した場合は取り込み済みフラグを立てず、loadConfig自体は成功させる', async () => {
    documentConfigFileFixture = {
      fileHash: DOC_SRC_HASH,
      annots: {},
      bookmarks: {},
      outlineImported: false,
    };
    outlineFixture = Failure(new Error('corrupted pdf'));

    const res = await loadConfig(buildFile('doc.pdf'));
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.outlineImported).toBeFalsy();
  });

  it('既存のブックマークは取り込みによって消えない', async () => {
    const existingId = 'existing' as BookmarkID;
    documentConfigFileFixture = {
      fileHash: DOC_SRC_HASH,
      annots: {},
      bookmarks: {
        [existingId]: { id: existingId, title: '既存', pageNumber: 1 },
      },
      outlineImported: false,
    };
    outlineFixture = Success([{ title: '新規', level: 0, pageNumber: 3 }]);

    const res = await loadConfig(buildFile('doc.pdf'));
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    const titles = Object.values(res.value.bookmarks).map((b) => b.title);
    expect(titles.sort()).toEqual(['新規', '既存'].sort());
  });
});
