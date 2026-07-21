import { describe, expect, it } from 'bun:test';
import { hexToRgba } from '../hexToRgba';

describe('hexToRgba', () => {
  it('6桁の16進カラーコードをrgba文字列に変換する', () => {
    expect(hexToRgba('#0000ff', 0.5)).toBe('rgba(0, 0, 255, 0.5)');
  });

  it('3桁の16進カラーコードをrgba文字列に変換する', () => {
    expect(hexToRgba('#0f0', 1)).toBe('rgba(0, 255, 0, 1)');
  });

  it('#なしのカラーコードも受け付ける', () => {
    expect(hexToRgba('ff0000', 0.25)).toBe('rgba(255, 0, 0, 0.25)');
  });
});
