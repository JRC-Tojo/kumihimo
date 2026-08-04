import { describe, expect, it, afterEach } from 'bun:test';

// bunのテスト環境にはbrowserの`window`が存在しないため、`queryLocalFonts`の差し替え用に
// 最小限のグローバルを用意する（`isLocalFontAccessSupported`はwindow自体の有無も判定するため、
// 各テストで必要な時だけプロパティを生やす方式にする）
if (typeof globalThis.window === 'undefined') {
  (globalThis as unknown as { window: unknown }).window = globalThis;
}

import {
  isLocalFontAccessSupported,
  queryLocalFonts,
  findBestFontMatch,
  getFontBytes,
} from '../localFontAccess';

function buildFontData(overrides: Partial<FontData> = {}): FontData {
  return {
    postscriptName: 'TestFont-Regular',
    fullName: 'Test Font',
    family: 'Test Font',
    style: 'Regular',
    blob: () => Promise.resolve(new Blob([new Uint8Array([1, 2, 3])])),
    ...overrides,
  };
}

afterEach(() => {
  Reflect.deleteProperty(window, 'queryLocalFonts');
});

describe('isLocalFontAccessSupported', () => {
  it('window.queryLocalFontsが関数の場合はtrueを返す', () => {
    window.queryLocalFonts = () => Promise.resolve([]);
    expect(isLocalFontAccessSupported()).toBeTrue();
  });

  it('window.queryLocalFontsが未定義の場合はfalseを返す', () => {
    expect(isLocalFontAccessSupported()).toBeFalse();
  });
});

describe('queryLocalFonts', () => {
  it('非対応ブラウザの場合はFailureを返す', async () => {
    const res = await queryLocalFonts();
    expect(res.ok).toBeFalse();
  });

  it('対応ブラウザで正常時はフォント一覧を返す', async () => {
    const fonts = [buildFontData()];
    window.queryLocalFonts = () => Promise.resolve(fonts);
    const res = await queryLocalFonts();
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toEqual(fonts);
  });

  it('ユーザーが許可プロンプトを拒否した場合（rejectする）はFailureを返す', async () => {
    window.queryLocalFonts = () => Promise.reject(new Error('permission denied'));
    const res = await queryLocalFonts();
    expect(res.ok).toBeFalse();
  });
});

describe('findBestFontMatch', () => {
  it('ファミリー名が一致するフォントが無い場合はundefinedを返す', () => {
    const fonts = [buildFontData({ family: 'Other Font' })];
    expect(findBestFontMatch(fonts, 'Test Font', false)).toBeUndefined();
  });

  it('bold=falseの場合、Regularスタイルを優先する', () => {
    const regular = buildFontData({ style: 'Regular' });
    const bold = buildFontData({ style: 'Bold' });
    const match = findBestFontMatch([bold, regular], 'Test Font', false);
    expect(match).toBe(regular);
  });

  it('bold=trueの場合、Boldスタイル（Italicは除く）を優先する', () => {
    const regular = buildFontData({ style: 'Regular' });
    const bold = buildFontData({ style: 'Bold' });
    const boldItalic = buildFontData({ style: 'Bold Italic' });
    const match = findBestFontMatch([regular, boldItalic, bold], 'Test Font', true);
    expect(match).toBe(bold);
  });

  it('bold=trueで対応するBoldスタイルが無い場合は先頭の一致にフォールバックする', () => {
    const regular = buildFontData({ style: 'Regular' });
    const match = findBestFontMatch([regular], 'Test Font', true);
    expect(match).toBe(regular);
  });

  it('ファミリー名は大文字小文字を区別しない', () => {
    const font = buildFontData({ family: 'Test Font' });
    expect(findBestFontMatch([font], 'test font', false)).toBe(font);
  });
});

describe('getFontBytes', () => {
  it('正常時はUint8Arrayを返す', async () => {
    const font = buildFontData();
    const res = await getFontBytes(font);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('blob()が失敗した場合はFailureを返す', async () => {
    const font = buildFontData({ blob: () => Promise.reject(new Error('read failed')) });
    const res = await getFontBytes(font);
    expect(res.ok).toBeFalse();
  });
});
