import { describe, expect, it, mock } from 'bun:test';
import type { DocumentSource } from 'src/models/document/common';
import { AnnotationID, ColorCode, type BoxAnnotationStyle } from 'src/models/document/pdf';
import { Success, type Result } from 'src/models/error/result';

/**
 * `trackPdfAnnotation`のページ単位オーケストレーション（進捗通知・並列実行・タグ付け）のみを検証する。
 * ONNXセッション・PDFレンダリング・特徴点マッチングはすべてモック化し、実際の推論は行わない
 *
 * 注意: `bun test`の`mock.module`はプロセス全体で共有され、テストファイルをまたいで残り続ける。
 * 同じ`src/repositories/document/pdf`を`pageCorrespondence.test.ts`でも（別の関数を）
 * モックしているため、どちらが先に評価されても他方が必要とする関数が欠けないよう、
 * ここでもその関数をスタブとして含めておく（実際にはこのファイルからは呼ばれない）
 */
const getLightGlueSessionMock = mock(
  (): Promise<Result<object>> => Promise.resolve(Success({})),
);
void mock.module('src/utils/tracker/lightglueSession', () => ({
  getLightGlueSession: getLightGlueSessionMock,
}));

const getNumPagesMock = mock((): Promise<Result<number>> => Promise.resolve(Success(3)));
const renderPageToCanvasMock = mock(
  (): Promise<Result<unknown>> => Promise.resolve(Success({})),
);
void mock.module('src/repositories/document/pdf', () => ({
  getNumPages: getNumPagesMock,
  renderPageToCanvas: renderPageToCanvasMock,
  extractTextByPage: mock((): Promise<Result<string>> => Promise.resolve(Success(''))),
}));

// 平行移動(+5,+5)相当の対応点を返す（ページ3は対応点なしとして追跡失敗を模す）
const matchPageImagesMock = mock((oldCanvas: unknown, newCanvas: unknown) => {
  void oldCanvas;
  void newCanvas;
  return Promise.resolve(
    Success({
      oldPoints: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ],
      newPoints: [
        { x: 5, y: 5 },
        { x: 15, y: 5 },
        { x: 5, y: 15 },
      ],
      scores: [0.9, 0.9, 0.9],
    }),
  );
});
void mock.module('src/utils/tracker/pageRegistration', () => ({
  matchPageImages: matchPageImagesMock,
}));

const buildPageCorrespondenceMock = mock(
  (
    _oldSrc: DocumentSource,
    _newSrc: DocumentSource,
    targetOldPageNumbers: number[],
  ): Promise<Map<number, number | undefined>> =>
    Promise.resolve(
      new Map(targetOldPageNumbers.map((p) => [p, p === 3 ? undefined : p])),
    ),
);
void mock.module('src/utils/tracker/pageCorrespondence', () => ({
  buildPageCorrespondence: buildPageCorrespondenceMock,
}));

const { trackPdfAnnotation, LOW_CONFIDENCE_TAG } = await import('../trackPdfAnnot');

function buildBoxStyle(pageNumber: number): BoxAnnotationStyle {
  return {
    type: 'box',
    id: AnnotationID.parse(`00000000-0000-4000-8000-00000000000${pageNumber}`),
    pageNumber,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    color: ColorCode.parse('#000000'),
    strokeWidth: 2,
    strokeType: 'solid',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    comment: {},
  };
}

const oldSrc = 'old' as unknown as DocumentSource;
const newSrc = 'new' as unknown as DocumentSource;

describe('trackPdfAnnotation', () => {
  it('ページごとに進捗を通知し、最終的に完了件数が総ページ数と一致する', async () => {
    const annotStyles = [buildBoxStyle(1), buildBoxStyle(2), buildBoxStyle(3)];
    const progressCalls: { completed: number; total: number }[] = [];

    const result = await trackPdfAnnotation(oldSrc, newSrc, annotStyles, (p) =>
      progressCalls.push({ ...p }),
    );

    expect(result.ok).toBeTrue();
    expect(progressCalls[0]).toEqual({ completed: 0, total: 3 });
    expect(progressCalls.at(-1)).toEqual({ completed: 3, total: 3 });
    // completedは単調増加する
    for (let i = 1; i < progressCalls.length; i++) {
      expect(progressCalls[i]!.completed).toBeGreaterThanOrEqual(progressCalls[i - 1]!.completed);
    }
  });

  it('対応する新ページが見つからないページのアノテーションは座標を維持し低信頼タグを付与する', async () => {
    const annotStyles = [buildBoxStyle(3)];

    const result = await trackPdfAnnotation(oldSrc, newSrc, annotStyles);

    expect(result.ok).toBeTrue();
    if (result.ok) {
      expect(result.value[0]!.x).toBe(0);
      expect(result.value[0]!.y).toBe(0);
      expect(result.value[0]!.tags).toContain(LOW_CONFIDENCE_TAG);
    }
  });

  it('マッチングに成功したページのアノテーションは推定した変換で座標が更新され、低信頼タグは付かない', async () => {
    const annotStyles = [buildBoxStyle(1)];

    const result = await trackPdfAnnotation(oldSrc, newSrc, annotStyles);

    expect(result.ok).toBeTrue();
    if (result.ok) {
      const updated = result.value[0]!;
      expect(updated.x).toBeCloseTo(5, 4);
      expect(updated.y).toBeCloseTo(5, 4);
      expect(updated.tags ?? []).not.toContain(LOW_CONFIDENCE_TAG);
    }
  });

  it('アノテーションが空の場合は何もせずそのまま返す', async () => {
    const result = await trackPdfAnnotation(oldSrc, newSrc, []);
    expect(result.ok).toBeTrue();
    if (result.ok) expect(result.value).toEqual([]);
  });
});
