import { describe, expect, it, mock } from 'bun:test';
import type { ContainerID } from 'src/models/container';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import type { AnnotationInfo } from 'src/models/relational/fileSchema';
import { Success, Failure } from 'src/models/error/result';

/**
 * `src/repositories/db/annotation`と`src/services/container/main`をモック化し、
 * IndexedDB（Dexie）を使わずにサービス層のロジックのみを検証する
 */
const updateAnnotationStyleMock = mock(() => Promise.resolve(Success()));
const getAnnotationInfoMock = mock((id: AnnotationID) =>
  Promise.resolve(
    Success<AnnotationInfo>({
      style: baseStyle(id),
      context: { text: 'OCRで抽出済みのテキスト' },
    }),
  ),
);
const addAnnotationInfosMock = mock(() => Promise.resolve(Success()));

void mock.module('src/repositories/db/annotation', () => ({
  getAnnotationInfo: getAnnotationInfoMock,
  updateAnnotationStyle: updateAnnotationStyleMock,
  addAnnotationInfos: addAnnotationInfosMock,
}));

void mock.module('src/services/container/main', () => ({
  loadFileAsDocumentSource: () => Promise.resolve(Failure(new Error('not used in this test'))),
}));

// pdfjs-distはブラウザAPI（DOMMatrix等）に依存するため、bunのテスト環境ではimportするだけで
// 失敗する。reorderAnnotationStyle/pasteAnnotationsの経路では実際には呼ばれないため、
// ダミー実装で置き換えてimport自体を回避する
void mock.module('src/repositories/document/pdf', () => ({
  extractImageFromRegion: () => Promise.resolve(Failure(new Error('not used in this test'))),
  extractAnnotationContextPreview: () =>
    Promise.resolve(Failure(new Error('not used in this test'))),
  extractTextByAnnot: () => Promise.resolve(Failure(new Error('not used in this test'))),
}));

const { reorderAnnotationStyle, pasteAnnotations } = await import('../annotation');

const containerID = '00000000-0000-4000-8000-000000000000' as ContainerID;
const file = {
  containerID,
  type: 'File' as const,
  path: 'doc.pdf',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  description: '',
  genre: '',
  tags: [],
};

function baseStyle(id: AnnotationID, overrides: Partial<AnnotationStyle> = {}): AnnotationStyle {
  return {
    id,
    type: 'box',
    pageNumber: 1,
    x: 0,
    y: 0,
    color: '#000000' as never,
    strokeWidth: 2,
    strokeType: 'solid',
    width: 10,
    height: 10,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    comment: {},
    ...overrides,
  } as AnnotationStyle;
}

const idA = '00000000-0000-4000-8000-000000000001' as AnnotationID;
const idB = '00000000-0000-4000-8000-000000000002' as AnnotationID;

describe('reorderAnnotationStyle', () => {
  it('registerAnnotationStyleを経由せず、既存のOCR抽出結果（context）を保持したまま返す', async () => {
    updateAnnotationStyleMock.mockClear();
    addAnnotationInfosMock.mockClear();

    const annotations = [baseStyle(idA, { zIndex: 1 }), baseStyle(idB, { zIndex: 2 })];
    const res = await reorderAnnotationStyle(file, annotations, idA, 'front');

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    // 既存のOCRテキストが失われず、そのまま引き継がれていること
    expect(res.value.context.text).toBe('OCRで抽出済みのテキスト');
    expect(res.value.style.zIndex).toBe(3); // front: maxKey(2) + 1

    // 新規登録用のaddAnnotationInfos（bulkPut）は呼ばれず、部分更新のみが呼ばれること
    expect(updateAnnotationStyleMock).toHaveBeenCalledTimes(1);
    expect(addAnnotationInfosMock).not.toHaveBeenCalled();
  });

  it('対象の注釈が見つからない場合はFailureを返す', async () => {
    const annotations = [baseStyle(idA)];
    const missingId = '00000000-0000-4000-8000-000000000099' as AnnotationID;
    const res = await reorderAnnotationStyle(file, annotations, missingId, 'front');
    expect(res.ok).toBeFalse();
  });
});

describe('pasteAnnotations', () => {
  it('複製した注釈のzIndexをリセットし、元の重ね順キーと衝突しないようにする', async () => {
    addAnnotationInfosMock.mockClear();

    const sources = [baseStyle(idA, { zIndex: 5 })];
    const res = await pasteAnnotations(file, sources, 1, 20);

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toHaveLength(1);
    const pasted = res.value[0]?.style;
    expect(pasted?.zIndex).toBeUndefined();
    expect(pasted?.id).not.toBe(idA);
    expect(pasted?.x).toBe(sources[0]!.x + 20);
    expect(pasted?.y).toBe(sources[0]!.y + 20);

    expect(addAnnotationInfosMock).toHaveBeenCalledTimes(1);
  });
});
