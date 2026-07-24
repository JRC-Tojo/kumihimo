import { describe, expect, it, mock } from 'bun:test';
import { ContainerID } from 'src/models/container';
import { Success, Failure } from 'src/models/error/result';
import type { PluginManifest } from 'src/models/plugin/manifest';

const containerID = ContainerID.parse('11111111-1111-4111-8111-111111111111');
const targetFile = {
  containerID,
  type: 'File' as const,
  path: 'a.pdf',
  createdAt: new Date(),
  updatedAt: new Date(),
  description: '説明',
  genre: 'ジャンル',
  tags: ['tag1'],
};

// 注意: `bun test`のmock.moduleはプロセス全体で共有される（テストファイルをまたいで永続する）ため、
// 同じモジュールパスを複数のテストファイルでモックする場合は、他ファイルが必要とする関数も
// スタブとして含めておくこと
void mock.module('src/services/container/main', () => ({
  loadFileAsDocumentSource: () => Promise.resolve(Success('dummy-src' as never)),
  getContainer: () => Success({ id: containerID, name: 'テストコンテナ', type: 'local' } as never),
}));

const getAnnotationsByFileMock = mock(() => Promise.resolve(Success([])));
void mock.module('src/services/document/annotation', () => ({
  getAnnotationsByFile: getAnnotationsByFileMock,
  registerAnnotationStyle: () => Promise.resolve(Failure(new Error('not used in this test'))),
  removeAnnotationInfo: () => Promise.resolve(Failure(new Error('not used in this test'))),
  getAnnotationAddress: () => Promise.resolve(Failure(new Error('not used in this test'))),
}));

const acquirePdfDocumentMock = mock(() =>
  Promise.resolve(Success({ document: { numPages: 2 } as never, release: () => {} })),
);
void mock.module('src/repositories/document/pdfDocumentCache', () => ({
  acquirePdfDocument: acquirePdfDocumentMock,
  invalidatePdfDocument: () => {},
}));

const getPageSizeFromDocMock = mock(() => Promise.resolve(Success({ width: 600, height: 800 })));
const extractTextBlocksByPageFromDocMock = mock(() => Promise.resolve(Success([])));
const renderPageToCanvasFromDocMock = mock(() =>
  Promise.resolve(Success({ toDataURL: () => 'data:image/png;base64,xxx' } as never)),
);
void mock.module('src/repositories/document/pdf', () => ({
  getPageSizeFromDoc: getPageSizeFromDocMock,
  extractTextBlocksByPageFromDoc: extractTextBlocksByPageFromDocMock,
  renderPageToCanvasFromDoc: renderPageToCanvasFromDocMock,
  // 他テストファイル（annotation.test.ts等）とモック形状を揃えるための残りのスタブ
  getNumPages: () => Promise.resolve(Failure(new Error('not used in this test'))),
  getPageSize: () => Promise.resolve(Failure(new Error('not used in this test'))),
  extractTextBlocksByPage: () => Promise.resolve(Failure(new Error('not used in this test'))),
  renderPageToCanvas: () => Promise.resolve(Failure(new Error('not used in this test'))),
  extractImageFromRegion: () => Promise.resolve(Failure(new Error('not used in this test'))),
  extractAnnotationContextPreview: () =>
    Promise.resolve(Failure(new Error('not used in this test'))),
  extractTextByAnnot: () => Promise.resolve(Failure(new Error('not used in this test'))),
}));

const { buildExecutionContext } = await import('../hostContext');

function buildManifest(requiredHostApis: PluginManifest['requiredHostApis']): PluginManifest {
  return {
    id: 'test-plugin' as never,
    name: 'テストプラグイン',
    version: '1.0.0',
    description: '',
    runtime: 'wasm',
    mainFile: 'test.wasm',
    requiredHostApis,
  };
}

const secondContainerID = ContainerID.parse('55555555-5555-4555-8555-555555555555');
const secondTargetFile = {
  containerID: secondContainerID,
  type: 'File' as const,
  path: 'b.pdf',
  createdAt: new Date(),
  updatedAt: new Date(),
  description: '',
  genre: '',
  tags: [],
};

describe('buildExecutionContext', () => {
  it('メタ情報・代表ページサイズ・ページ数は常に組み立てられる（fileContexts[0]がtargetFiles[0]に対応）', async () => {
    const res = await buildExecutionContext(buildManifest([]), [targetFile]);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    expect(res.value.fileContexts).toHaveLength(1);
    expect(res.value.fileContexts[0]?.pageCount).toBe(2);
    expect(res.value.representativePageSize).toEqual({ width: 600, height: 800 });
    const metadata = JSON.parse(res.value.fileContexts[0]?.metadataJson ?? '{}');
    expect(metadata.pageCount).toBe(2);
    expect(metadata.filePath).toBe('a.pdf');
  });

  it('doc.getPageSizeが要求されていない場合、全ページのサイズ先読みは行われない', async () => {
    getPageSizeFromDocMock.mockClear();
    const res = await buildExecutionContext(buildManifest([]), [targetFile]);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    // 代表ページサイズ（1ページ目）取得の1回のみ呼ばれる
    expect(getPageSizeFromDocMock).toHaveBeenCalledTimes(1);
    expect(res.value.fileContexts[0]?.pageSizes.size).toBe(0);
  });

  it('doc.getPageSizeが要求されている場合、全ページのサイズが先読みされる', async () => {
    getPageSizeFromDocMock.mockClear();
    const res = await buildExecutionContext(buildManifest(['doc.getPageSize']), [targetFile]);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    // 代表ページサイズ1回 + 全ページ分（pageCount=2）
    expect(getPageSizeFromDocMock).toHaveBeenCalledTimes(3);
    expect(res.value.fileContexts[0]?.pageSizes.size).toBe(2);
  });

  it('doc.getPageTextBlocksが要求されていない場合はテキストブロックを先読みしない', async () => {
    extractTextBlocksByPageFromDocMock.mockClear();
    const res = await buildExecutionContext(buildManifest([]), [targetFile]);
    expect(res.ok).toBeTrue();
    expect(extractTextBlocksByPageFromDocMock).not.toHaveBeenCalled();
  });

  it('doc.getPageImageが要求されていない場合はページ画像を先読みしない（重い処理の回避）', async () => {
    renderPageToCanvasFromDocMock.mockClear();
    const res = await buildExecutionContext(buildManifest([]), [targetFile]);
    expect(res.ok).toBeTrue();
    expect(renderPageToCanvasFromDocMock).not.toHaveBeenCalled();
  });

  it('doc.getAnnotationsByFile/doc.getAnnotationIdsByTagのいずれかが要求されている場合のみ既存アノテーションを取得する', async () => {
    getAnnotationsByFileMock.mockClear();
    await buildExecutionContext(buildManifest([]), [targetFile]);
    expect(getAnnotationsByFileMock).not.toHaveBeenCalled();

    getAnnotationsByFileMock.mockClear();
    await buildExecutionContext(buildManifest(['doc.getAnnotationIdsByTag']), [targetFile]);
    expect(getAnnotationsByFileMock).toHaveBeenCalledTimes(1);
  });

  it('複数のtargetFilesを指定した場合、ファイルごとにPDFを取得しfileContextsを並び順通りに組み立てる', async () => {
    acquirePdfDocumentMock.mockClear();
    getAnnotationsByFileMock.mockClear();
    const res = await buildExecutionContext(buildManifest(['doc.getAnnotationsByFile']), [
      targetFile,
      secondTargetFile,
    ]);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    expect(acquirePdfDocumentMock).toHaveBeenCalledTimes(2);
    expect(getAnnotationsByFileMock).toHaveBeenCalledTimes(2);
    expect(res.value.fileContexts).toHaveLength(2);
    // 代表ページサイズはtargetFiles[0]（主対象ファイル）の値のみを保持する
    expect(res.value.representativePageSize).toEqual({ width: 600, height: 800 });
  });
});
