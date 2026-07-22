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

const getPageSizeMock = mock(() => Promise.resolve(Success({ width: 600, height: 800 })));
const extractTextBlocksByPageMock = mock(() => Promise.resolve(Success([])));
const renderPageToCanvasMock = mock(() =>
  Promise.resolve(Success({ toDataURL: () => 'data:image/png;base64,xxx' } as never)),
);
void mock.module('src/repositories/document/pdf', () => ({
  getNumPages: () => Promise.resolve(Success(2)),
  getPageSize: getPageSizeMock,
  extractTextBlocksByPage: extractTextBlocksByPageMock,
  renderPageToCanvas: renderPageToCanvasMock,
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

describe('buildExecutionContext', () => {
  it('メタ情報・代表ページサイズ・ページ数は常に組み立てられる', async () => {
    const res = await buildExecutionContext(buildManifest([]), targetFile);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    expect(res.value.pageCount).toBe(2);
    expect(res.value.representativePageSize).toEqual({ width: 600, height: 800 });
    const metadata = JSON.parse(res.value.metadataJson);
    expect(metadata.pageCount).toBe(2);
    expect(metadata.filePath).toBe('a.pdf');
  });

  it('doc.getPageSizeが要求されていない場合、全ページのサイズ先読みは行われない', async () => {
    getPageSizeMock.mockClear();
    const res = await buildExecutionContext(buildManifest([]), targetFile);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    // 代表ページサイズ（1ページ目）取得の1回のみ呼ばれる
    expect(getPageSizeMock).toHaveBeenCalledTimes(1);
    expect(res.value.pageSizes.size).toBe(0);
  });

  it('doc.getPageSizeが要求されている場合、全ページのサイズが先読みされる', async () => {
    getPageSizeMock.mockClear();
    const res = await buildExecutionContext(buildManifest(['doc.getPageSize']), targetFile);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    // 代表ページサイズ1回 + 全ページ分（pageCount=2）
    expect(getPageSizeMock).toHaveBeenCalledTimes(3);
    expect(res.value.pageSizes.size).toBe(2);
  });

  it('doc.getPageTextBlocksが要求されていない場合はテキストブロックを先読みしない', async () => {
    extractTextBlocksByPageMock.mockClear();
    const res = await buildExecutionContext(buildManifest([]), targetFile);
    expect(res.ok).toBeTrue();
    expect(extractTextBlocksByPageMock).not.toHaveBeenCalled();
  });

  it('doc.getPageImageが要求されていない場合はページ画像を先読みしない（重い処理の回避）', async () => {
    renderPageToCanvasMock.mockClear();
    const res = await buildExecutionContext(buildManifest([]), targetFile);
    expect(res.ok).toBeTrue();
    expect(renderPageToCanvasMock).not.toHaveBeenCalled();
  });

  it('doc.getAnnotationsByFile/doc.getAnnotationIdsByTagのいずれかが要求されている場合のみ既存アノテーションを取得する', async () => {
    getAnnotationsByFileMock.mockClear();
    await buildExecutionContext(buildManifest([]), targetFile);
    expect(getAnnotationsByFileMock).not.toHaveBeenCalled();

    getAnnotationsByFileMock.mockClear();
    await buildExecutionContext(buildManifest(['doc.getAnnotationIdsByTag']), targetFile);
    expect(getAnnotationsByFileMock).toHaveBeenCalledTimes(1);
  });
});
