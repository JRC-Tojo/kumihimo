import { describe, expect, it, mock } from 'bun:test';
import type { DocumentSource } from 'src/models/document/common';
import { Success, type Result } from 'src/models/error/result';

/**
 * `src/repositories/document/pdf`をモック化し、実際のPDF読み込みを行わずに
 * `buildPageCorrespondence`のページ対応付けロジックのみを検証する
 *
 * 注意: `bun test`の`mock.module`はプロセス全体で共有され、テストファイルをまたいで残り続ける。
 * 同じモジュールパスを`trackPdfAnnot.test.ts`でも（別の関数を）モックしているため、
 * どちらが先に評価されても他方が必要とする関数が欠けないよう、ここでもその関数を
 * スタブとして含めておく（実際にはこのファイルからは呼ばれない）
 */
const OLD_PAGE_TEXT: Record<number, string> = {
  1: '契約書 第一条 目的 本契約は業務委託に関する事項を定める',
  2: '第二条 委託料 委託料は月額10万円とする',
  3: '第三条 契約期間 本契約の有効期間は1年間とする',
};
const NEW_PAGE_TEXT: Record<number, string> = {
  1: '表紙 サンプル文書',
  2: '契約書 第一条 目的 本契約は業務委託に関する事項を定める',
  3: '第二条 委託料 委託料は月額10万円とする',
  4: '第三条 契約期間 本契約の有効期間は1年間とする',
};

const extractTextByPageMock = mock(
  (src: DocumentSource, pageNumber: number): Promise<Result<string>> => {
    const table = src === 'old' ? OLD_PAGE_TEXT : NEW_PAGE_TEXT;
    return Promise.resolve(Success(table[pageNumber] ?? ''));
  },
);

void mock.module('src/repositories/document/pdf', () => ({
  extractTextByPage: extractTextByPageMock,
  getNumPages: mock((): Promise<Result<number>> => Promise.resolve(Success(0))),
  renderPageToCanvas: mock((): Promise<Result<unknown>> => Promise.resolve(Success({}))),
}));

const { buildPageCorrespondence } = await import('../pageCorrespondence');

const oldSrc = 'old' as unknown as DocumentSource;
const newSrc = 'new' as unknown as DocumentSource;

describe('buildPageCorrespondence', () => {
  it('ページ数が一致する場合は同一ページ番号のまま対応させる（テキスト比較を行わない）', async () => {
    const correspondence = await buildPageCorrespondence(oldSrc, newSrc, [1, 2], 3, 3);

    expect(correspondence.get(1)).toBe(1);
    expect(correspondence.get(2)).toBe(2);
    expect(extractTextByPageMock).not.toHaveBeenCalled();
  });

  it('ページが1枚挿入された場合、テキスト類似度により正しい新ページへ対応づけられる', async () => {
    const correspondence = await buildPageCorrespondence(oldSrc, newSrc, [1, 2, 3], 3, 4);

    expect(correspondence.get(1)).toBe(2);
    expect(correspondence.get(2)).toBe(3);
    expect(correspondence.get(3)).toBe(4);
  });

  it('対応する内容の新ページが見つからない場合はundefinedを返す', async () => {
    // OLD_PAGE_TEXTに存在しないページ番号（=空テキスト）を指定し、
    // 新文書のどのページとも類似度0になる（対応なし）ケースを検証する
    const correspondence = await buildPageCorrespondence(oldSrc, newSrc, [99], 3, 4);

    expect(correspondence.get(99)).toBeUndefined();
  });
});
