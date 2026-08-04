import { describe, expect, it } from 'bun:test';
import { wrapTextLines } from '../textWrap';

/** 1文字=1幅とみなす単純な計測関数（アルゴリズム自体の検証用） */
const measureByCharCount = (s: string): number => s.length;

describe('wrapTextLines', () => {
  it('半角スペース区切りの英単語は、幅に収まる限り同じ行にまとめる', () => {
    const lines = wrapTextLines('aa bb cc dd', 6, measureByCharCount);
    expect(lines).toEqual(['aa bb', 'cc dd']);
  });

  it('単語単体でmaxWidthを超える場合でも、その単語だけで1行にする（無限分割しない）', () => {
    const lines = wrapTextLines('abcdefghij', 5, measureByCharCount);
    expect(lines).toEqual(['abcdefghij']);
  });

  it('スペースが無い日本語文字列でも、1文字ずつ折り返される', () => {
    const lines = wrapTextLines('あいうえおかきくけこ', 4, measureByCharCount);
    expect(lines).toEqual(['あいうえ', 'おかきく', 'けこ']);
  });

  it('英数字とCJKが連続する文字列でも、1トークンにまとまらず折り返される', () => {
    const lines = wrapTextLines('abcあいうえお', 4, measureByCharCount);
    expect(lines).toEqual(['abcあ', 'いうえお']);
  });

  it('明示的な改行は段落区切りとして維持される', () => {
    const lines = wrapTextLines('あいう\nかきく', 10, measureByCharCount);
    expect(lines).toEqual(['あいう', 'かきく']);
  });

  it('全体が幅に収まる場合は折り返さない', () => {
    const lines = wrapTextLines('short', 100, measureByCharCount);
    expect(lines).toEqual(['short']);
  });

  it('空文字列は1つの空行を返す', () => {
    const lines = wrapTextLines('', 10, measureByCharCount);
    expect(lines).toEqual(['']);
  });
});
