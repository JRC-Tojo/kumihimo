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

/** 参照がなくなってから実際に破棄するまでの猶予（ミリ秒） */
const DISPOSE_GRACE_MS = 5000;

interface CacheEntry {
  promise: Promise<Result<PDFDocumentProxy>>;
  refCount: number;
  disposeTimer: ReturnType<typeof setTimeout> | undefined;
}

const cache = new Map<string, CacheEntry>();

async function loadDocument(src64: DocumentSource): Promise<Result<PDFDocumentProxy>> {
  const typedArray = base64ToUint8Array(src64);
  if (!typedArray.ok) return typedArray;

  try {
    const pdf = await pdfjsLib.getDocument({ data: typedArray.value }).promise;
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

async function disposeEntry(key: string): Promise<void> {
  const entry = cache.get(key);
  // 猶予期間の間に再取得されていれば何もしない
  if (!entry || entry.refCount > 0) return;

  cache.delete(key);
  const res = await entry.promise;
  if (res.ok) void res.value.destroy();
}

/**
 * 指定ファイルのPDFDocumentProxyを取得する（参照カウントを+1する）
 *
 * 同一ファイルへの2回目以降の呼び出しは、破棄猶予中も含めて既存のPDFDocumentProxyを再利用する。
 * 取得したら、使い終わり次第必ず`releasePdfDocument`を呼ぶこと（対応するreleaseを呼ばないと
 * PDFDocumentProxyとpdf.jsのWorkerスレッドが解放されなくなる）
 */
export async function acquirePdfDocument(
  file: FileIdentity,
  src64: DocumentSource,
): Promise<Result<PDFDocumentProxy>> {
  const key = fileKey(file);
  let entry = cache.get(key);

  if (!entry) {
    entry = { promise: loadDocument(src64), refCount: 0, disposeTimer: undefined };
    cache.set(key, entry);
  }

  clearDisposeTimer(entry);
  entry.refCount += 1;

  const res = await entry.promise;
  if (!res.ok) {
    // 読み込みに失敗した場合はキャッシュに残さず、次回呼び出しで再試行できるようにする
    entry.refCount -= 1;
    if (entry.refCount <= 0 && cache.get(key) === entry) cache.delete(key);
  }
  return res;
}

/**
 * `acquirePdfDocument`で取得したPDFDocumentProxyの参照を返却する（参照カウントを-1する）
 *
 * 参照が0になっても即座には破棄せず、`DISPOSE_GRACE_MS`の間に再度acquireされれば破棄をキャンセルする
 */
export function releasePdfDocument(file: FileIdentity): void {
  const key = fileKey(file);
  const entry = cache.get(key);
  if (!entry) return;

  entry.refCount = Math.max(0, entry.refCount - 1);
  if (entry.refCount > 0) return;

  clearDisposeTimer(entry);
  entry.disposeTimer = setTimeout(() => {
    void disposeEntry(key);
  }, DISPOSE_GRACE_MS);
}

/**
 * 指定ファイルの内容が変化した（外部変更の取り込み等）際、キャッシュされたPDFDocumentProxyを
 * 即座に破棄する。破棄後の次回acquireで最新内容を読み込み直す
 */
export function invalidatePdfDocument(file: FileIdentity): void {
  const key = fileKey(file);
  const entry = cache.get(key);
  if (!entry) return;

  clearDisposeTimer(entry);
  cache.delete(key);
  void entry.promise.then((res) => {
    if (res.ok) void res.value.destroy();
  });
}
