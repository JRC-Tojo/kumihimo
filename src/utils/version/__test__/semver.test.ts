import { describe, expect, it } from 'bun:test';
import { bumpVersion, parseSemver } from '../semver';

describe('parseSemver', () => {
  it('x.y.z形式を解釈できる', () => {
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseSemver('0.0.0')).toEqual({ major: 0, minor: 0, patch: 0 });
  });

  it('x.y.z形式でない場合はundefinedを返す', () => {
    for (const invalid of ['1.2', '1.2.3.4', 'v1.2.3', '1.2.x', '', 'latest']) {
      expect(parseSemver(invalid)).toBeUndefined();
    }
  });
});

describe('bumpVersion', () => {
  it('majorを1つ上げるとminor/patchは0にリセットされる', () => {
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0');
  });

  it('minorを1つ上げるとpatchは0にリセットされる', () => {
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0');
  });

  it('patchを1つ上げる', () => {
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4');
  });

  it('不正な形式のバージョンはundefinedを返す', () => {
    expect(bumpVersion('not-a-version', 'patch')).toBeUndefined();
  });
});
