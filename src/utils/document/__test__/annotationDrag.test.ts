import { describe, test, expect } from 'bun:test';
import { lockToDominantAxis, reflectAroundPoint, applyCenteredResize } from '../annotationDrag';

describe('lockToDominantAxis', () => {
  test('水平方向の移動量が大きい場合はy座標を開始位置に固定する', () => {
    const result = lockToDominantAxis({ x: 0, y: 0 }, { x: 10, y: 3 });
    expect(result).toEqual({ x: 10, y: 0 });
  });

  test('垂直方向の移動量が大きい場合はx座標を開始位置に固定する', () => {
    const result = lockToDominantAxis({ x: 0, y: 0 }, { x: 3, y: 10 });
    expect(result).toEqual({ x: 0, y: 10 });
  });

  test('移動量が等しい場合は水平方向を優先する', () => {
    const result = lockToDominantAxis({ x: 0, y: 0 }, { x: 5, y: 5 });
    expect(result).toEqual({ x: 5, y: 0 });
  });

  test('負の移動量でも正しく判定する', () => {
    const result = lockToDominantAxis({ x: 10, y: 10 }, { x: 2, y: 9 });
    expect(result).toEqual({ x: 2, y: 10 });
  });
});

describe('reflectAroundPoint', () => {
  test('中心点に対して点対称の座標を返す', () => {
    const result = reflectAroundPoint({ x: 0, y: 0 }, { x: 5, y: 5 });
    expect(result).toEqual({ x: 10, y: 10 });
  });

  test('中心点自身を渡すと同じ座標が返る', () => {
    const result = reflectAroundPoint({ x: 5, y: 5 }, { x: 5, y: 5 });
    expect(result).toEqual({ x: 5, y: 5 });
  });

  test('負の座標でも正しく反射する', () => {
    const result = reflectAroundPoint({ x: -2, y: 3 }, { x: 0, y: 0 });
    expect(result).toEqual({ x: 2, y: -3 });
  });
});

describe('applyCenteredResize', () => {
  test('中心を維持したまま新しい幅・高さに対応する左上座標を返す', () => {
    const startBox = { x: 0, y: 0, width: 10, height: 10 };
    const result = applyCenteredResize(startBox, { width: 20, height: 20 });
    // 元の中心(5,5)を維持しつつ幅高さ20になるので、左上は(-5,-5)になる
    expect(result).toEqual({ x: -5, y: -5 });
  });

  test('中心が原点でない場合も正しく中心を維持する', () => {
    const startBox = { x: 10, y: 20, width: 4, height: 8 };
    const result = applyCenteredResize(startBox, { width: 2, height: 4 });
    // 元の中心(12,24)を維持しつつ幅高さ(2,4)になるので、左上は(11,22)になる
    expect(result).toEqual({ x: 11, y: 22 });
  });
});
