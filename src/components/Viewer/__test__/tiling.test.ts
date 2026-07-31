/**
 * tiling.ts の単体テスト
 *
 * DOM・pdf.js依存の無い純粋なロジックのため、モック無しでそのままテストできる
 */
import { describe, expect, it } from 'bun:test';
import {
  clampScaleToPixelBudget,
  computeTiles,
  shouldUseTiling,
  TILE_ACTIVATION_PIXEL_BUDGET,
  TILE_SIZE_DEVICE_PX,
} from '../tiling';

describe('shouldUseTiling', () => {
  it('通常サイズのページ・通常倍率ではfalseを返す（A4相当、等倍、dpr=1）', () => {
    expect(shouldUseTiling({ width: 595, height: 842 }, 1, 1)).toBe(false);
  });

  it('通常サイズのページでも、高倍率×高DPRで予算を超えるとtrueを返す', () => {
    // 595 * 8 * 3 = 14280, 842 * 8 * 3 = 20208 → 面積 約2.89億px^2（予算1600万px^2を大きく超える）
    expect(shouldUseTiling({ width: 595, height: 842 }, 8, 3)).toBe(true);
  });

  it('境界値: 面積がちょうど予算と同じ場合はfalse（超えた場合のみtrue）', () => {
    const size = { width: 4000, height: 4000 };
    // 4000*1*1 * 4000*1*1 = 16,000,000 = TILE_ACTIVATION_PIXEL_BUDGET ちょうど
    expect(shouldUseTiling(size, 1, 1)).toBe(false);
    // ほんの少しでも超えるとtrue
    expect(shouldUseTiling({ width: 4000.1, height: 4000 }, 1, 1)).toBe(true);
  });
});

describe('clampScaleToPixelBudget', () => {
  it('既に予算内であれば、指定した倍率をそのまま返す', () => {
    expect(clampScaleToPixelBudget({ width: 595, height: 842 }, 1, 1)).toBe(1);
  });

  it('予算を超える場合、面積がちょうど予算に収まる倍率まで縮小する', () => {
    const size = { width: 1000, height: 1000 };
    const dpr = 1;
    const clamped = clampScaleToPixelBudget(size, 10, dpr); // 元の面積: 1e8 px^2（予算の6倍超）

    const clampedArea = size.width * clamped * dpr * (size.height * clamped * dpr);
    expect(clampedArea).toBeCloseTo(TILE_ACTIVATION_PIXEL_BUDGET, -1);
    expect(clamped).toBeLessThan(10);
  });

  it('独自の予算（pixelBudget）を指定した場合はそちらを使う', () => {
    const size = { width: 100, height: 100 };
    const clamped = clampScaleToPixelBudget(size, 10, 1, 40_000); // 予算=40,000px^2 = 200x200相当
    expect(clamped).toBeCloseTo(2, 5); // 100*2 * 100*2 = 40,000
  });
});

describe('computeTiles', () => {
  it('ページ全体がタイルサイズちょうど収まる場合、1x1のタイルになる', () => {
    const dpr = 1;
    const tileSizeCssPx = TILE_SIZE_DEVICE_PX / dpr;
    const tiles = computeTiles({ width: tileSizeCssPx, height: tileSizeCssPx }, 1, dpr);

    expect(tiles).toEqual([
      { col: 0, row: 0, x: 0, y: 0, width: tileSizeCssPx, height: tileSizeCssPx },
    ]);
  });

  it('端数がある場合、右端・下端のタイルだけ小さくなる（切り上げ分割）', () => {
    const dpr = 1;
    const tileSizeCssPx = TILE_SIZE_DEVICE_PX / dpr;
    // 幅: ちょうど2タイル分+端数、高さ: 1タイル分のみ
    const width = tileSizeCssPx * 2 + 100;
    const height = tileSizeCssPx;
    const tiles = computeTiles({ width, height }, 1, dpr);

    expect(tiles).toHaveLength(3); // cols=3 (ceil((2*tile+100)/tile)), rows=1
    expect(tiles[2]).toEqual({
      col: 2,
      row: 0,
      x: tileSizeCssPx * 2,
      y: 0,
      width: 100,
      height: tileSizeCssPx,
    });
  });

  it('scale・dprに応じてタイルの境界（CSS px）が変化する', () => {
    const dpr = 2;
    // device px換算のタイルサイズは512 CSS px（1024 device px / dpr 2）
    const tiles = computeTiles({ width: 1024, height: 512 }, 1, dpr);
    // scaledWidth=1024, scaledHeight=512, tileSizeCssPx=512 → cols=2, rows=1
    expect(tiles.map((t) => [t.col, t.row])).toEqual([
      [0, 0],
      [1, 0],
    ]);
    expect(tiles[0]?.width).toBe(512);
  });

  it('すべてのタイルを合成するとページ全体（scale適用後）を過不足なく覆う', () => {
    const scale = 1.5;
    const dpr = 1.5;
    const pageSize = { width: 1234, height: 987 };
    const tiles = computeTiles(pageSize, scale, dpr);

    const maxX = Math.max(...tiles.map((t) => t.x + t.width));
    const maxY = Math.max(...tiles.map((t) => t.y + t.height));
    expect(maxX).toBeCloseTo(pageSize.width * scale, 5);
    expect(maxY).toBeCloseTo(pageSize.height * scale, 5);

    // 重なりや隙間が無いことを、行・列ごとの隣接タイルの座標一致で確認する
    const cols = Math.max(...tiles.map((t) => t.col)) + 1;
    for (const tile of tiles) {
      const rightNeighbor = tiles.find((t) => t.row === tile.row && t.col === tile.col + 1);
      if (tile.col + 1 < cols) {
        expect(rightNeighbor?.x).toBeCloseTo(tile.x + tile.width, 5);
      }
    }
  });
});
