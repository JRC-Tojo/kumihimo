import { describe, expect, it } from 'bun:test';
import {
  clampZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  nextZoomStep,
  prevZoomStep,
  ZOOM_STEPS,
} from '../zoomSteps';

describe('clampZoom', () => {
  it('範囲内の値はそのまま返す', () => {
    expect(clampZoom(100)).toBe(100);
  });

  it('MIN_ZOOM未満はMIN_ZOOMに丸める', () => {
    expect(clampZoom(1)).toBe(MIN_ZOOM);
  });

  it('MAX_ZOOMを超える値はMAX_ZOOMに丸める', () => {
    expect(clampZoom(999)).toBe(MAX_ZOOM);
  });
});

describe('nextZoomStep', () => {
  it('現在値より大きい直近のステップを返す', () => {
    expect(nextZoomStep(100)).toBe(133);
    expect(nextZoomStep(101)).toBe(133);
  });

  it('ステップの中間値からでも次のステップに丸め上げる', () => {
    expect(nextZoomStep(150)).toBe(167);
  });

  it('最大ステップ以上の場合はMAX_ZOOMを返す', () => {
    expect(nextZoomStep(MAX_ZOOM)).toBe(MAX_ZOOM);
    expect(nextZoomStep(MAX_ZOOM + 100)).toBe(MAX_ZOOM);
  });
});

describe('prevZoomStep', () => {
  it('現在値より小さい直近のステップを返す', () => {
    expect(prevZoomStep(100)).toBe(75);
    expect(prevZoomStep(99)).toBe(75);
  });

  it('ステップの中間値からでも次に小さいステップに丸め下げる', () => {
    expect(prevZoomStep(150)).toBe(133);
  });

  it('最小ステップ以下の場合はMIN_ZOOMを返す', () => {
    expect(prevZoomStep(MIN_ZOOM)).toBe(MIN_ZOOM);
    expect(prevZoomStep(MIN_ZOOM - 10)).toBe(MIN_ZOOM);
  });
});

describe('ZOOM_STEPS', () => {
  it('昇順に並んでいる', () => {
    const sorted = [...ZOOM_STEPS].sort((a, b) => a - b);
    expect(ZOOM_STEPS).toEqual(sorted);
  });
});
