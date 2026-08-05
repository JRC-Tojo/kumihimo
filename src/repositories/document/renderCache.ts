/**
 * PDFページのレンダリング結果（`ImageBitmap`）を、ファイル・ページ・拡大率単位でキャッシュするモジュール
 *
 * タブの切り替えやページ移動、ズームの微調整（拡大→縮小→元の倍率に戻す等）では、同一ページ・
 * 同一倍率への再訪問が頻繁に起こる。その都度pdf.jsに再ラスタライズさせるのは無駄が大きいため、
 * レンダリング済みのoffscreen canvasから`createImageBitmap()`で生成した`ImageBitmap`を
 * キャッシュしておき、再訪問時はpdf.js側の呼び出し自体をスキップする。
 *
 * 保存形式に`ImageBitmap`を選ぶ理由:
 * - レンダリング済みのoffscreen canvasから`createImageBitmap()`で生成でき、`renderPage()`側の
 *   既存の`drawImage`転写ステップをそのまま再利用できる
 * - `.close()`で確実・即時にメモリ解放できる（ガベージコレクション任せにしない）
 * - contextを持つcanvas要素のまま大量に保持し続けるより、ブラウザのcanvas同時生成数の制約に対して安全
 *
 * `pdfDocumentCache.ts`と同様、モジュールスコープの`Map`として保持する（`DocumentTabView`が
 * タブ切り替えで破棄・再生成されても、キャッシュ自体は生き残る）
 */

interface CacheEntry {
  bitmap: ImageBitmap;
  byteSize: number;
}

/** キャッシュ全体で保持するバイト数の上限（概算）。少数の巨大な全ページ描画だけでこの予算を
 * 圧迫し続けるケースに対する保険で、具体的な数値は初期値の目安であり実測に応じて調整する前提 */
const MAX_CACHE_BYTES = 256 * 1024 * 1024;
/** キャッシュに保持するエントリ数の上限（同様に初期値の目安） */
const MAX_CACHE_ENTRIES = 300;

const cache = new Map<string, CacheEntry>();
let totalBytes = 0;

/** タイル単位でレンダリングする場合（巨大ページ×高拡大率）のタイル位置情報 */
export interface RenderCacheTileKey {
  col: number;
  row: number;
  tileSize: number;
}

export interface RenderCacheKeyParts {
  fileKey: string;
  pageNumber: number;
  scale: number;
  devicePixelRatio: number;
  tile?: RenderCacheTileKey;
}

/**
 * レンダリングキャッシュのキーを生成する。
 *
 * `scale`は丸めずそのまま使う。`Math.round(scale * 100)`のように丸めると、pdf.jsへ実際に渡される
 * 丸め前のscale（`pdfManager.ts`の`renderPage`/`renderPageTile`が`page.getViewport`へ渡す値）が
 * わずかに異なる複数の呼び出し（例: 1.001と1.004）が同一キーに収束してしまい、キャッシュヒット時に
 * 別倍率でレンダリングされた画像を誤って再利用してしまう
 */
export function renderCacheKey(parts: RenderCacheKeyParts): string {
  const base = `${parts.fileKey}|${parts.pageNumber}|${parts.scale}|${parts.devicePixelRatio}`;
  if (!parts.tile) return base;
  return `${base}|${parts.tile.col}:${parts.tile.row}:${parts.tile.tileSize}`;
}

/** `ImageBitmap`のおおよそのメモリ占有量（RGBA、1px=4byte換算） */
function estimateByteSize(bitmap: ImageBitmap): number {
  return bitmap.width * bitmap.height * 4;
}

/** アクセスされたエントリをMapの末尾（＝最新）へ移動する（Mapは挿入順を保持するため、
 * 先頭側が自然とLRU側になる） */
function touch(key: string, entry: CacheEntry): void {
  cache.delete(key);
  cache.set(key, entry);
}

/** バイト数・エントリ数どちらかの上限を超えている間、最も古い（最近アクセスされていない）
 * エントリから`.close()`しつつ削除する */
function evictIfNeeded(): void {
  const iterator = cache.entries();
  while (totalBytes > MAX_CACHE_BYTES || cache.size > MAX_CACHE_ENTRIES) {
    const next = iterator.next();
    if (next.done) break;
    const [key, entry] = next.value;
    cache.delete(key);
    totalBytes -= entry.byteSize;
    entry.bitmap.close();
  }
}

/** キャッシュ済みのレンダリング結果を取得する。ヒットした場合はLRU順の最新側へ移動する */
export function getCachedRender(key: string): ImageBitmap | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  touch(key, entry);
  return entry.bitmap;
}

/** レンダリング結果をキャッシュに保存する。同一キーの既存エントリがあれば先に`.close()`する */
export function setCachedRender(key: string, bitmap: ImageBitmap): void {
  const existing = cache.get(key);
  if (existing) {
    totalBytes -= existing.byteSize;
    existing.bitmap.close();
    cache.delete(key);
  }

  const byteSize = estimateByteSize(bitmap);
  cache.set(key, { bitmap, byteSize });
  totalBytes += byteSize;

  evictIfNeeded();
}

/**
 * 指定ファイルに属するキャッシュ済みレンダリング結果をすべて無効化する
 * （外部変更の取り込み等、`pdfDocumentCache.ts`の`invalidatePdfDocument`と対で呼ばれる）
 */
export function invalidateRenderCache(fileKeyValue: string): void {
  const prefix = `${fileKeyValue}|`;
  for (const [key, entry] of cache) {
    if (!key.startsWith(prefix)) continue;
    cache.delete(key);
    totalBytes -= entry.byteSize;
    entry.bitmap.close();
  }
}
