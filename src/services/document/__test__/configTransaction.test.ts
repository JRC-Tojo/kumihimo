import { describe, expect, it, mock } from 'bun:test';
import type { AnnotationGroupID } from 'src/models/document/group';
import type { ContainerElementFile, ContainerID } from 'src/models/container';
import type { Result } from 'src/models/error/result';
import { Success } from 'src/models/error/result';
import type { DocumentConfigFile } from 'src/models/relational/fileSchema';
import type { DocumentSource } from 'src/models/document/common';
import { calcBase64Hash } from 'src/utils/binary/base64';

/**
 * `config.ts`の`updateConfig`が、実際に`.kcfg`への読み込み→書き込みをファイル単位で
 * 直列化していることを検証する回帰テスト（グループ機能フォローアップ作業で発見した
 * lost update不具合の再現・防止用）。
 *
 * `getDocumentConfigFile`/`saveDocumentConfigFile`をオンメモリの擬似ストアとして実装し、
 * 読み込み側に人為的な遅延を入れることで、直列化されていなければ2つの`updateConfig`呼び出しが
 * 互いのcurrentを読み違えて上書きし合う（lost update）状況を意図的に起きやすくする
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
const docSrcHashRes = await calcBase64Hash(DOC_SRC);
if (!docSrcHashRes.ok) throw docSrcHashRes.error;
const DOC_SRC_HASH = docSrcHashRes.value;

void mock.module('src/services/container/main', () => ({
  loadFileAsDocumentSource: (): Promise<Result<DocumentSource>> => Promise.resolve(Success(DOC_SRC)),
}));

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// key: `${containerID}|${path}` -> 擬似的に永続化されたDocumentConfigFile
const fakeConfigStore = new Map<string, DocumentConfigFile>();
const READ_DELAY_MS = 20;

const getDocumentConfigFileMock = mock(
  async (_cID: ContainerID, target: ContainerElementFile | string): Promise<Result<DocumentConfigFile>> => {
    const path = typeof target === 'string' ? target : target.path;
    const key = `${_cID}|${path}`;
    const current = fakeConfigStore.get(key) ?? {
      fileHash: DOC_SRC_HASH,
      annots: {},
      bookmarks: {},
      groups: {},
      outlineImported: true,
    };
    // 直列化されていなければ、この遅延の間に他の書き込みが割り込む余地が生まれる
    await delay(READ_DELAY_MS);
    return Success({ ...current, groups: { ...current.groups } });
  },
);

const saveDocumentConfigFileMock = mock(
  (
    cID: ContainerID,
    filePath: string,
    annotInfos: unknown[],
    fileHash: string,
    bookmarks: DocumentConfigFile['bookmarks'],
    groups: DocumentConfigFile['groups'],
    outlineImported: boolean,
  ): Promise<Result<void>> => {
    const key = `${cID}|${filePath}`;
    fakeConfigStore.set(key, {
      fileHash,
      annots: Object.fromEntries((annotInfos as { style: { id: string } }[]).map((a) => [a.style.id, a])),
      bookmarks,
      groups,
      outlineImported,
    } as DocumentConfigFile);
    return Promise.resolve(Success());
  },
);

void mock.module('src/services/container/config', () => ({
  getDocumentConfigFile: getDocumentConfigFileMock,
  saveDocumentConfigFile: saveDocumentConfigFileMock,
}));

const registerConfigAnnotationInfosMock = mock((): Promise<Result<void>> => Promise.resolve(Success()));
void mock.module('src/services/document/annotation', () => ({
  registerConfigAnnotationInfos: registerConfigAnnotationInfosMock,
}));
const syncGroupCacheMock = mock((): Promise<Result<void>> => Promise.resolve(Success()));
void mock.module('src/services/document/annotationGroup', () => ({
  syncGroupCache: syncGroupCacheMock,
  remapFilePath: (): Promise<Result<void>> => Promise.resolve(Success()),
}));
void mock.module('src/repositories/document/pdf', () => ({
  getOutline: (): Promise<Result<never[]>> => Promise.resolve(Success([])),
}));
// pdfDocumentCache/renderCacheはpdf.js（DOMMatrix等）に依存するため、config.test.tsと同様にモック化する
void mock.module('src/repositories/document/pdfDocumentCache', () => ({
  invalidatePdfDocument: () => {},
}));
void mock.module('src/repositories/document/renderCache', () => ({
  invalidateRenderCache: () => {},
}));

const { loadConfig, updateConfig } = await import('../config');

describe('updateConfig（.kcfg読み書きの直列化・lost update防止の回帰テスト）', () => {
  it('同じファイルへの2つのupdateConfigを同時に発火しても、両方の変更が最終状態に残る', async () => {
    const file = buildFile('doc-concurrent.pdf');
    fakeConfigStore.set(`${containerID}|doc-concurrent.pdf`, {
      fileHash: DOC_SRC_HASH,
      annots: {},
      bookmarks: {},
      groups: {},
      outlineImported: true,
    });

    const addGroup = (id: string) =>
      updateConfig(file, (current) =>
        Success({
          next: {
            ...current,
            groups: {
              ...current.groups,
              [id]: {
                id: id as AnnotationGroupID,
                memberIds: [],
                valueAggregation: undefined,
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
              },
            },
          },
          result: undefined,
        }),
      );

    // 直列化されていなければ、両方とも読み込み時点で相手の変更をまだ知らないまま
    // 上書きし合い、どちらか一方のグループが消えてしまう
    await Promise.all([addGroup('group-a'), addGroup('group-b')]);

    const finalRes = await loadConfig(file);
    expect(finalRes.ok).toBe(true);
    if (!finalRes.ok) return;
    expect(Object.keys(finalRes.value.groups).sort()).toEqual(['group-a', 'group-b']);
  });

  it('異なるファイルへのupdateConfigは互いに影響しない', async () => {
    const fileA = buildFile('doc-a.pdf');
    const fileB = buildFile('doc-b.pdf');
    fakeConfigStore.set(`${containerID}|doc-a.pdf`, {
      fileHash: DOC_SRC_HASH,
      annots: {},
      bookmarks: {},
      groups: {},
      outlineImported: true,
    });
    fakeConfigStore.set(`${containerID}|doc-b.pdf`, {
      fileHash: DOC_SRC_HASH,
      annots: {},
      bookmarks: {},
      groups: {},
      outlineImported: true,
    });

    await Promise.all([
      updateConfig(fileA, (current) =>
        Success({ next: { ...current, outlineImported: true }, result: undefined }),
      ),
      updateConfig(fileB, (current) =>
        Success({ next: { ...current, outlineImported: true }, result: undefined }),
      ),
    ]);

    expect((await loadConfig(fileA)).ok).toBe(true);
    expect((await loadConfig(fileB)).ok).toBe(true);
  });

  it('updateConfigの内部読み込みはアノテーションDB同期の副作用を伴わない（自動保存でのDB巻き戻り回帰確認）', async () => {
    // saveConfig（自動保存）は、DB側を既に確定済みの最新状態へ更新した後にupdateConfigを
    // 呼ぶ。updateConfigの内部読み込みが（loadConfigと同様に）.kcfgの古いannots内容を
    // registerConfigAnnotationInfos経由でDBへ同期してしまうと、直後の正しい書き込みで
    // 上書きされるまでの間、DBが一瞬（あるいはUIの再描画タイミング次第でそれ以上）
    // 古い状態へ巻き戻って見えてしまう。updateConfigはこの副作用を伴ってはならない
    const file = buildFile('doc-no-resync.pdf');
    fakeConfigStore.set(`${containerID}|doc-no-resync.pdf`, {
      fileHash: DOC_SRC_HASH,
      annots: {},
      bookmarks: {},
      groups: {},
      outlineImported: true,
    });

    registerConfigAnnotationInfosMock.mockClear();
    const res = await updateConfig(file, (current) =>
      Success({ next: { ...current, outlineImported: true }, result: undefined }),
    );
    expect(res.ok).toBe(true);
    expect(registerConfigAnnotationInfosMock).not.toHaveBeenCalled();

    // 対照として、公開loadConfigは引き続きDB同期の副作用を伴うこと
    registerConfigAnnotationInfosMock.mockClear();
    await loadConfig(file);
    expect(registerConfigAnnotationInfosMock).toHaveBeenCalledTimes(1);
  });

  it('updateConfigの内部読み込みはグループキャッシュ同期の副作用も伴わない（書き込み後の同期のみで完結する）', async () => {
    const file = buildFile('doc-no-group-resync.pdf');
    fakeConfigStore.set(`${containerID}|doc-no-group-resync.pdf`, {
      fileHash: DOC_SRC_HASH,
      annots: {},
      bookmarks: {},
      groups: {},
      outlineImported: true,
    });

    syncGroupCacheMock.mockClear();
    const res = await updateConfig(file, (current) =>
      Success({ next: { ...current, outlineImported: true }, result: undefined }),
    );
    expect(res.ok).toBe(true);
    // 書き込み成功後の同期（writeConfigUnlocked経由）で1回だけ呼ばれること
    // （読み込み側からの追加呼び出しが無いこと）
    expect(syncGroupCacheMock).toHaveBeenCalledTimes(1);
  });
});
