import { describe, expect, it } from 'bun:test';
import {
  buildHeadLocalSvgPath,
  computeHeadTransform,
  getHeadLocalPoints,
  getHeadRadius,
  isClosedHead,
  isFilledHead,
} from '../arrowHeadGeometry';
import type { ArrowHeadType } from 'src/models/document/pdf';

const ALL_TYPES: ArrowHeadType[] = [
  'none',
  'triangle',
  'open',
  'square',
  'circle',
  'diamond',
  'butt',
  'slash',
  'reverseOpen',
  'reverseTriangle',
];

describe('getHeadLocalPoints / getHeadRadius', () => {
  it('noneとcircleはgetHeadLocalPointsでnullを返す', () => {
    expect(getHeadLocalPoints('none', 10)).toBeNull();
    expect(getHeadLocalPoints('circle', 10)).toBeNull();
  });

  it('circle以外はgetHeadRadiusでnullを返す', () => {
    for (const type of ALL_TYPES) {
      if (type === 'circle') continue;
      expect(getHeadRadius(type, 10)).toBeNull();
    }
  });

  it('circleはgetHeadRadiusでsizeの半分を返す', () => {
    expect(getHeadRadius('circle', 10)).toBe(5);
  });

  it('triangle/reverseTriangle/openは3頂点（6要素）を返す', () => {
    expect(getHeadLocalPoints('triangle', 10)).toHaveLength(6);
    expect(getHeadLocalPoints('reverseTriangle', 10)).toHaveLength(6);
    expect(getHeadLocalPoints('open', 10)).toHaveLength(6);
  });

  it('square/diamondは4頂点（8要素）を返す', () => {
    expect(getHeadLocalPoints('square', 10)).toHaveLength(8);
    expect(getHeadLocalPoints('diamond', 10)).toHaveLength(8);
  });

  it('butt/slashは2頂点（4要素）を返す', () => {
    expect(getHeadLocalPoints('butt', 10)).toHaveLength(4);
    expect(getHeadLocalPoints('slash', 10)).toHaveLength(4);
  });

  it('triangleの先端は原点(0,0)にある', () => {
    const points = getHeadLocalPoints('triangle', 10);
    expect(points?.slice(0, 2)).toEqual([0, 0]);
  });
});

describe('isFilledHead / isClosedHead', () => {
  const filledExpected: Record<ArrowHeadType, boolean> = {
    none: false,
    triangle: true,
    open: false,
    square: true,
    circle: true,
    diamond: true,
    butt: false,
    slash: false,
    reverseOpen: false,
    reverseTriangle: true,
  };
  const closedExpected: Record<ArrowHeadType, boolean> = {
    none: false,
    triangle: true,
    open: false,
    square: true,
    circle: false,
    diamond: true,
    butt: false,
    slash: false,
    reverseOpen: false,
    reverseTriangle: true,
  };

  for (const type of ALL_TYPES) {
    it(`isFilledHead('${type}') === ${filledExpected[type]}`, () => {
      expect(isFilledHead(type)).toBe(filledExpected[type]);
    });
    it(`isClosedHead('${type}') === ${closedExpected[type]}`, () => {
      expect(isClosedHead(type)).toBe(closedExpected[type]);
    });
  }
});

describe('computeHeadTransform', () => {
  it('水平な矢印（endHead）: tipは終点、angleDegは0', () => {
    const result = computeHeadTransform([0, 0, 10, 0], 'end');
    expect(result).toEqual({ tipX: 10, tipY: 0, angleDeg: 0 });
  });

  it('水平な矢印（startHead）: tipは始点、angleDegは180（終点から見て逆方向）', () => {
    const result = computeHeadTransform([0, 0, 10, 0], 'start');
    expect(result?.tipX).toBe(0);
    expect(result?.tipY).toBe(0);
    expect(result?.angleDeg).toBeCloseTo(180);
  });

  it('垂直な矢印（endHead）: angleDegは90', () => {
    const result = computeHeadTransform([0, 0, 0, 10], 'end');
    expect(result?.angleDeg).toBeCloseTo(90);
  });

  it('斜め45度の矢印（endHead）: angleDegは45', () => {
    const result = computeHeadTransform([0, 0, 10, 10], 'end');
    expect(result?.angleDeg).toBeCloseTo(45);
  });

  it('複数頂点のpolylineでも、endHeadは末尾の線分だけを見る', () => {
    const result = computeHeadTransform([0, 0, 10, 0, 10, 10], 'end');
    expect(result?.tipX).toBe(10);
    expect(result?.tipY).toBe(10);
    expect(result?.angleDeg).toBeCloseTo(90);
  });

  it('複数頂点のpolylineでも、startHeadは先頭の線分だけを見る', () => {
    const result = computeHeadTransform([0, 0, 10, 0, 10, 10], 'start');
    expect(result?.tipX).toBe(0);
    expect(result?.tipY).toBe(0);
    expect(result?.angleDeg).toBeCloseTo(180);
  });

  it('始点と終点が一致する（長さ0の線分）場合はnullを返す', () => {
    expect(computeHeadTransform([5, 5, 5, 5], 'end')).toBeNull();
  });

  it('points配列の要素数が4未満の場合はnullを返す', () => {
    expect(computeHeadTransform([0, 0], 'end')).toBeNull();
  });
});

describe('buildHeadLocalSvgPath', () => {
  it('noneはnullを返す', () => {
    expect(buildHeadLocalSvgPath('none', 10)).toBeNull();
  });

  it('circleはnullを返す（呼び出し側でgetHeadRadius経由の<circle>を使うべきため）', () => {
    expect(buildHeadLocalSvgPath('circle', 10)).toBeNull();
  });

  it('triangleは閉じたパス（Zを含む）を返す', () => {
    const path = buildHeadLocalSvgPath('triangle', 10);
    expect(path).toContain('M0,0');
    expect(path).toContain('Z');
  });

  it('openは開いたパス（Zを含まない）を返す', () => {
    const path = buildHeadLocalSvgPath('open', 10);
    expect(path).not.toBeNull();
    expect(path).not.toContain('Z');
  });
});
