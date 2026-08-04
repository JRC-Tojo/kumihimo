/**
 * PDF.jsのPDFDocumentProxyをファイル単位で参照カウント付きキャッシュするモジュール
 *
 * アノテーションを1件移動・編集するたびにPDF全体を読み込み直すと、pdf.js内部が
 * ドキュメントごとに新しいWorkerスレッドを生成するため、`.destroy()`せずに使い捨てると
 * メモリ・Workerスレッドが際限なく増え続けてしまう。同一ファイルへの複数回のアクセスは
 * 同じPDFDocumentProxyを再利用し、参照がなくなった際にのみ破棄することでこれを防ぐ。
 *
 * 参照が0になった瞬間に即破棄すると、`extractTextByAnnot`→`extractImageFromRegion`のように
 * 短時間に連続して行われる複数の抽出処理のたびに再読込が発生してしまうため、
 * 一定の猶予期間（`DISPOSE_GRACE_MS`）を空けてから実際に破棄する。
 */

import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { DocumentSource } from 'src/models/document/common';
import { Failure, Success, toError, type Result } from 'src/models/error/result';
import { base64ToUint8Array } from 'src/utils/binary/base64';
import { fileKey, type FileIdentity } from 'src/utils/document/fileKey';
import { PDF_STANDARD_FONT_DATA_URL } from 'src/utils/document/pdfStandardFontDataUrl';
import { PDFJS_GET_DOCUMENT_ASSET_OPTIONS } from 'src/utils/document/pdfjsAssets';

/** 参照がなくなってから実際に破棄するまでの猶予（ミリ秒） */
const DISPOSE_GRACE_MS = 5000;

interface CacheEntry {
  promise: Promise<Result<PDFDocumentProxy>>;
  refCount: number;
  disposeTimer: ReturnType<typeof setTimeout> | undefined;
  /** `invalidatePdfDocument`で無効化済みか。trueの間は再利用されず、最後のreleaseで破棄される */
  stale: boolean;
  /** `destroyEntry`による二重destroyを防ぐためのフラグ */
  destroyed: boolean;
}

/** `acquirePdfDocument`が返す、1回の取得に対応する解放ハンドル */
export interface AcquiredPdfDocument {
  document: PDFDocumentProxy;
  /** 取得時点のentry実体に紐づく解放処理。ファイルキーではなくこのentry自体を減算するため、
   * `invalidatePdfDocument`後に同キーで新しいentryが作られても誤って新entryを減算しない */
  release: () => void;
}

const cache = new Map<string, CacheEntry>();

async function loadDocument(src64: DocumentSource): Promise<Result<PDFDocumentProxy>> {
  const typedArray = base64ToUint8Array(src64);
  if (!typedArray.ok) return typedArray;

  try {
    // 標準14フォント（Helvetica等）はグリフの輪郭データを内蔵せず埋め込まれていないため、
    // pdf.js自身が持つフォールバック用の輪郭データの場所を教えないと、該当フォントを
    // 使うテキストが描画されない（プロジェクトには同梱せず、必要になった時点でCDNから取得する）
    const pdf = await pdfjsLib.getDocument({
      data: typedArray.value,
      standardFontDataUrl: PDF_STANDARD_FONT_DATA_URL,
      ...PDFJS_GET_DOCUMENT_ASSET_OPTIONS,
    }).promise;
    return Success(pdf);
  } catch (e) {
    return Failure(toError(e));
  }
}

function clearDisposeTimer(entry: CacheEntry): void {
  if (entry.disposeTimer !== undefined) {
    clearTimeout(entry.disposeTimer);
    entry.disposeTimer = undefined;
  }
}

/** entryのPDFDocumentProxyを一度だけ破棄する */
async function destroyEntry(entry: CacheEntry): Promise<void> {
  if (entry.destroyed) return;
  entry.destroyed = true;
  clearDisposeTimer(entry);

  const res = await entry.promise;
  if (res.ok) await res.value.destroy();
}

/** stale化されておらず未参照のentryを、猶予期間後に破棄する */
function scheduleDispose(key: string, entry: CacheEntry): void {
  clearDisposeTimer(entry);

  entry.disposeTimer = setTimeout(() => {
    // 猶予期間中の再取得、無効化、または後続entryへの置換があれば破棄しない
    if (entry.refCount > 0 || entry.stale || cache.get(key) !== entry) return;

    cache.delete(key);
    void destroyEntry(entry);
  }, DISPOSE_GRACE_MS);
}

/**
 * 指定ファイルのPDFDocumentProxyを取得し、対応する解放ハンドルを返す（参照カウントを+1する）
 *
 * 同一ファイルへの2回目以降の呼び出しは、破棄猶予中も含めて既存のPDFDocumentProxyを再利用する。
 * 取得したら、使い終わり次第必ず戻り値の`release()`を呼ぶこと（呼ばないとPDFDocumentProxyと
 * pdf.jsのWorkerスレッドが解放されなくなる）
 */
export async function acquirePdfDocument(
  file: FileIdentity,
  src64: DocumentSource,
): Promise<Result<AcquiredPdfDocument>> {
  const key = fileKey(file);
  let entry = cache.get(key);

  if (!entry) {
    entry = {
      promise: loadDocument(src64),
      refCount: 0,
      disposeTimer: undefined,
      stale: false,
      destroyed: false,
    };
    cache.set(key, entry);
  }

  clearDisposeTimer(entry);
  entry.refCount += 1;

  const res = await entry.promise;
  if (!res.ok) {
    // 読み込みに失敗した場合はキャッシュに残さず、次回呼び出しで再試行できるようにする
    entry.refCount -= 1;
    if (entry.refCount <= 0 && cache.get(key) === entry) cache.delete(key);
    return Failure(res.error);
  }

  // このacquire呼び出しで取得したentry実体を閉じ込め、release時にファイルキー経由で
  // 引き直さないようにする（無効化後に同キーの新entryが作られても誤って減算しない）
  const acquiredEntry = entry;
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;

    acquiredEntry.refCount = Math.max(0, acquiredEntry.refCount - 1);
    if (acquiredEntry.refCount > 0) return;

    // stale化されたentryは再利用対象外なので、最後の参照が返却された時点で破棄する
    if (acquiredEntry.stale) {
      void destroyEntry(acquiredEntry);
      return;
    }

    scheduleDispose(key, acquiredEntry);
  };

  return Success({ document: res.value, release });
}

/**
 * 指定ファイルの内容が変化した（外部変更の取り込み等）際、キャッシュされたPDFDocumentProxyを
 * 無効化する。表示中のタブやOCR処理が参照を保持している間は破棄せず、最後の`release()`まで
 * 遅延する（保持中に即destroyすると、参照中の`getPage`/`render`が壊れるため）。
 * 無効化後の次回acquireは新しいentryを作成し、最新内容を読み込み直す
 */
export function invalidatePdfDocument(file: FileIdentity): void {
  const key = fileKey(file);
  const entry = cache.get(key);
  if (!entry) return;

  clearDisposeTimer(entry);
  entry.stale = true;

  // 以後のacquireは新しいentryを作成して最新のPDFを読むようにする
  if (cache.get(key) === entry) cache.delete(key);

  // 保持者がいない場合だけ直ちに破棄する
  if (entry.refCount === 0) void destroyEntry(entry);
}
