import { describe, expect, it } from 'bun:test';
import { strokeTypeToDash } from '../strokeDash';

describe('strokeTypeToDash', () => {
  it('strokeTypeが未指定の場合はundefinedを返す（実線扱い）', () => {
    expect(strokeTypeToDash(undefined, 2)).toBeUndefined();
  });

  it("'solid'の場合はundefinedを返す", () => {
    expect(strokeTypeToDash('solid', 2)).toBeUndefined();
  });

  it("'double'の場合もKonvaが二重線を未サポートのためundefinedを返す", () => {
    expect(strokeTypeToDash('double', 2)).toBeUndefined();
  });

  it("'dashed'はstrokeWidthに応じてスケールしたdashパターンを返す", () => {
    expect(strokeTypeToDash('dashed', 1)).toEqual([4, 3]);
    expect(strokeTypeToDash('dashed', 2)).toEqual([8, 6]);
  });

  it("'dotted'はstrokeWidthに応じてスケールしたdashパターンを返す", () => {
    expect(strokeTypeToDash('dotted', 1)).toEqual([1, 2]);
    expect(strokeTypeToDash('dotted', 3)).toEqual([3, 6]);
  });

  it("'dash-dot'はstrokeWidthに応じてスケールしたdashパターンを返す", () => {
    expect(strokeTypeToDash('dash-dot', 1)).toEqual([4, 2, 1, 2]);
    expect(strokeTypeToDash('dash-dot', 2)).toEqual([8, 4, 2, 4]);
  });

  it('strokeWidthが0以下の場合は1px相当にフォールバックする', () => {
    expect(strokeTypeToDash('dashed', 0)).toEqual([4, 3]);
    expect(strokeTypeToDash('dashed', -5)).toEqual([4, 3]);
  });
});
