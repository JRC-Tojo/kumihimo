/**
 * renderCache.ts の単体テスト
 *
 * このモジュール自体はDOM APIを直接呼ばない（`ImageBitmap`はキー付きMapに保持されるだけの
 * 値として扱われる）ため、`{width, height, close()}`を備えた疑似オブジェクトをそのまま
 * `ImageBitmap`として渡せる（実際に`lib.dom.d.ts`上の`ImageBitmap`もこの3つ以外のメンバーを持たない）。
 * モジュールスコープの`cache`・`totalBytes`はテスト間で共有されるため、各テストで一意な
 * `fileKey`を使い、他テストの残留エントリと衝突しないようにする
 */
import { describe, expect, it, mock } from 'bun:test';
import {
  getCachedRender,
  invalidateRenderCache,
  renderCacheKey,
  setCachedRender as set,
} from '../renderCache';

/** `close()`の呼び出し回数を検証できる疑似ImageBitmapを作る */
function buildFakeBitmap(width: number, height: number) {
  return { width, height, close: mock(() => {}) };
}

describe('renderCacheKey', () => {
  it('tileを指定しない場合、fileKey|page|scale*100|dprの形式になる', () => {
    expect(
      renderCacheKey({ fileKey: 'c1|a.pdf', pageNumber: 3, scale: 1.5, devicePixelRatio: 2 }),
    ).toBe('c1|a.pdf|3|150|2');
  });

  it('tileを指定した場合、末尾にcol:row:tileSizeが付与される', () => {
    expect(
      renderCacheKey({
        fileKey: 'c1|a.pdf',
        pageNumber: 1,
        scale: 1,
        devicePixelRatio: 1,
        tile: { col: 2, row: 3, tileSize: 1024 },
      }),
    ).toBe('c1|a.pdf|1|100|1|2:3:1024');
  });
});

describe('get/setCachedRender', () => {
  it('未登録キーはundefinedを返す', () => {
    expect(getCachedRender('renderCacheTest|missing')).toBeUndefined();
  });

  it('登録した内容をそのまま取得できる', () => {
    const bitmap = buildFakeBitmap(100, 100);
    set('renderCacheTest|basic', bitmap);
    expect(getCachedRender('renderCacheTest|basic')).toBe(bitmap);
  });

  it('同一キーへの再登録は、古いbitmapをcloseしてから置き換える', () => {
    const first = buildFakeBitmap(10, 10);
    const second = buildFakeBitmap(10, 10);
    set('renderCacheTest|overwrite', first);
    set('renderCacheTest|overwrite', second);

    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).not.toHaveBeenCalled();
    expect(getCachedRender('renderCacheTest|overwrite')).toBe(second);
  });
});

describe('LRUエビクション', () => {
  it('エントリ数上限（300）を超えると、最も古いエントリからcloseされ削除される', () => {
    const bitmaps = Array.from({ length: 305 }, () => buildFakeBitmap(1, 1));
    bitmaps.forEach((bitmap, i) => set(`renderCacheTest|lru|${i}`, bitmap));

    // 先頭5件（0〜4）が押し出されているはず
    for (let i = 0; i < 5; i++) {
      expect(bitmaps[i]?.close).toHaveBeenCalledTimes(1);
      expect(getCachedRender(`renderCacheTest|lru|${i}`)).toBeUndefined();
    }
    // 直近300件は残っているはず
    for (let i = 5; i < 305; i++) {
      expect(getCachedRender(`renderCacheTest|lru|${i}`)).toBe(bitmaps[i]);
    }
  });

  it('getCachedRenderでアクセスしたエントリはLRU順の最新側に移動し、エビクション対象になりにくくなる', () => {
    const keep = buildFakeBitmap(1, 1);
    set('renderCacheTest|touch|keep', keep);

    // keepを含め300件ちょうどまで積み増した直後は全件残っている
    for (let i = 0; i < 299; i++) {
      set(`renderCacheTest|touch|filler-${i}`, buildFakeBitmap(1, 1));
    }
    expect(getCachedRender('renderCacheTest|touch|keep')).toBe(keep);

    // keepへアクセスして最新側へ移動させた直後に1件追加すると、keepではなく
    // 直後に追加されていた最古のfillerが押し出される
    getCachedRender('renderCacheTest|touch|keep');
    set('renderCacheTest|touch|extra', buildFakeBitmap(1, 1));

    expect(getCachedRender('renderCacheTest|touch|keep')).toBe(keep);
    expect(getCachedRender('renderCacheTest|touch|filler-0')).toBeUndefined();
  });

  it('バイト数上限（256MB相当）を超えると、古いエントリからcloseされ削除される', () => {
    // 8000x8000x4byte = 256,000,000byte（上限=268,435,456byte弱）のbitmapを2つ登録すると
    // 合計512,000,000byteとなり上限を超えるため、先に入れた方が押し出される
    const first = buildFakeBitmap(8000, 8000);
    const second = buildFakeBitmap(8000, 8000);
    set('renderCacheTest|bytes|first', first);
    set('renderCacheTest|bytes|second', second);

    expect(first.close).toHaveBeenCalledTimes(1);
    expect(getCachedRender('renderCacheTest|bytes|first')).toBeUndefined();
    expect(getCachedRender('renderCacheTest|bytes|second')).toBe(second);
  });
});

describe('invalidateRenderCache', () => {
  it('指定したfileKeyに属するエントリのみをcloseして削除する', () => {
    const targetA = buildFakeBitmap(1, 1);
    const targetB = buildFakeBitmap(1, 1);
    const other = buildFakeBitmap(1, 1);
    set(
      renderCacheKey({ fileKey: 'invalidTest|x', pageNumber: 1, scale: 1, devicePixelRatio: 1 }),
      targetA,
    );
    set(
      renderCacheKey({ fileKey: 'invalidTest|x', pageNumber: 2, scale: 1, devicePixelRatio: 1 }),
      targetB,
    );
    set(
      renderCacheKey({ fileKey: 'invalidTest|y', pageNumber: 1, scale: 1, devicePixelRatio: 1 }),
      other,
    );

    invalidateRenderCache('invalidTest|x');

    expect(targetA.close).toHaveBeenCalledTimes(1);
    expect(targetB.close).toHaveBeenCalledTimes(1);
    expect(other.close).not.toHaveBeenCalled();
    expect(
      getCachedRender(
        renderCacheKey({ fileKey: 'invalidTest|x', pageNumber: 1, scale: 1, devicePixelRatio: 1 }),
      ),
    ).toBeUndefined();
    expect(
      getCachedRender(
        renderCacheKey({ fileKey: 'invalidTest|y', pageNumber: 1, scale: 1, devicePixelRatio: 1 }),
      ),
    ).toBe(other);
  });

  it('fileKeyが他のfileKeyの前方一致（区切りの|を含まない）である場合は誤って巻き込まない', () => {
    const shortKeyEntry = buildFakeBitmap(1, 1);
    set(
      renderCacheKey({ fileKey: 'prefixTest|x', pageNumber: 1, scale: 1, devicePixelRatio: 1 }),
      shortKeyEntry,
    );

    invalidateRenderCache('prefixTest|x2'); // 前方一致するが別のfileKey

    expect(shortKeyEntry.close).not.toHaveBeenCalled();
  });
});
