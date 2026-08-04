/**
 * pdfDocumentCache.ts の単体テスト
 *
 * `pdfjs-dist`はモジュール読み込み時にDOM APIを評価するため、bunのテスト環境では
 * 素のままimportできない。`mock.module`で`pdfjs-dist`自体を差し替えることで
 * DOM依存を回避しつつ、`getDocument`の呼び出し回数・引数を検証できるようにする。
 *
 * また`DISPOSE_GRACE_MS`(5000ms)の実時間待ちを避けるため、`globalThis.setTimeout`を
 * 「呼ばれた関数を記録するだけで即座には実行しないフェイク」に差し替え、
 * テスト側で明示的にコールバックを発火させることで猶予期間経過を再現する。
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ContainerID } from 'src/models/container';
import type { FileIdentity } from 'src/utils/document/fileKey';
import type { DocumentSource } from 'src/models/document/common';

/** テスト用の疑似PDFDocumentProxy。`destroy`の呼び出し回数を検証できるようmockでラップする */
function buildFakePdfDocument() {
  return {
    destroy: mock(() => Promise.resolve()),
  };
}

/** `getDocument`が返す `{ promise }` の形を組み立てる（成功時） */
function resolvedGetDocumentResult(doc: ReturnType<typeof buildFakePdfDocument>) {
  return { promise: Promise.resolve(doc) };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
const getDocumentMock = mock((_args: { data: Uint8Array }) =>
  resolvedGetDocumentResult(buildFakePdfDocument()),
);

void mock.module('pdfjs-dist', () => ({
  getDocument: getDocumentMock,
  version: '0.0.0-test',
}));

const { acquirePdfDocument, invalidatePdfDocument } = await import('../pdfDocumentCache');

/** テストごとに衝突しないファイル識別子を作る（モジュールスコープのcacheがテスト間で共有されるため） */
let fileCounter = 0;
function makeFile(): FileIdentity {
  fileCounter += 1;
  return {
    containerID: '00000000-0000-4000-8000-000000000000' as ContainerID,
    path: `doc-${fileCounter}.pdf`,
  };
}

/** テスト用のダミーbase64ソース（`base64ToUint8Array`が成功する妥当な文字列） */
const VALID_SRC = 'aGVsbG8=' as DocumentSource;

describe('acquirePdfDocument / invalidatePdfDocument', () => {
  // setTimeoutを「呼ばれた関数を記録するだけ」のフェイクに差し替え、
  // テスト側で明示的に発火させることでDISPOSE_GRACE_MS(5000ms)の実時間待ちを回避する
  const originalSetTimeout = globalThis.setTimeout;
  let timers: Array<() => void>;

  beforeEach(() => {
    getDocumentMock.mockClear();
    timers = [];
    globalThis.setTimeout = ((fn: () => void) => {
      timers.push(fn);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
  });

  afterEach(() => {
    globalThis.setTimeout = originalSetTimeout;
  });

  /** 直近に登録されたタイマーコールバックを取り出して手動発火する */
  function fireLatestTimer(): void {
    const fn = timers.pop();
    if (!fn) throw new Error('タイマーが登録されていません');
    fn();
  }

  it('初回acquireでgetDocumentが1回呼ばれ、成功時はdocumentが返る', async () => {
    const file = makeFile();
    const res = await acquirePdfDocument(file, VALID_SRC);

    expect(res.ok).toBeTrue();
    expect(getDocumentMock).toHaveBeenCalledTimes(1);
    if (!res.ok) return;
    expect(res.value.document).toBeDefined();
  });

  it('同一ファイルへの2回目のacquireはgetDocumentを再度呼ばない（Promiseキャッシュの再利用）', async () => {
    const file = makeFile();
    const first = await acquirePdfDocument(file, VALID_SRC);
    const second = await acquirePdfDocument(file, VALID_SRC);

    expect(getDocumentMock).toHaveBeenCalledTimes(1);
    expect(first.ok && second.ok && first.value.document === second.value.document).toBeTrue();

    if (first.ok) first.value.release();
    if (second.ok) second.value.release();
  });

  it('release()を呼んでもrefCount>0の間は破棄されない（2回acquireして1回だけrelease）', async () => {
    const file = makeFile();
    const first = await acquirePdfDocument(file, VALID_SRC);
    const second = await acquirePdfDocument(file, VALID_SRC);
    expect(first.ok).toBeTrue();
    expect(second.ok).toBeTrue();
    if (!first.ok || !second.ok) return;

    first.value.release();

    // refCountがまだ1残っているため、破棄タイマーは登録されないはず
    expect(timers).toHaveLength(0);

    second.value.release();
  });

  it('refCountが0になった後、猶予経過（フェイクタイマー発火）でdocument.destroy()が呼ばれ、cacheから消える', async () => {
    const file = makeFile();
    const acquired = await acquirePdfDocument(file, VALID_SRC);
    expect(acquired.ok).toBeTrue();
    if (!acquired.ok) return;

    const doc = acquired.value.document as unknown as ReturnType<typeof buildFakePdfDocument>;
    acquired.value.release();

    // 猶予期間の破棄タイマーが1件登録されているはず
    expect(timers).toHaveLength(1);
    fireLatestTimer();
    // destroyEntry内部はPromiseチェーンなのでマイクロタスクの完了を待つ
    await Promise.resolve();
    await Promise.resolve();

    expect(doc.destroy).toHaveBeenCalledTimes(1);

    // cacheから消えているため、再acquireするとgetDocumentが再度呼ばれる
    const reacquired = await acquirePdfDocument(file, VALID_SRC);
    expect(getDocumentMock).toHaveBeenCalledTimes(2);
    if (reacquired.ok) reacquired.value.release();
  });

  it('猶予期間中に再acquireされると、破棄タイマーがキャンセルされdestroy()は呼ばれない（同じentryを再利用）', async () => {
    const file = makeFile();
    const first = await acquirePdfDocument(file, VALID_SRC);
    expect(first.ok).toBeTrue();
    if (!first.ok) return;

    const doc = first.value.document as unknown as ReturnType<typeof buildFakePdfDocument>;
    first.value.release();
    expect(timers).toHaveLength(1);

    // 猶予期間中に再acquire -> clearTimeoutが呼ばれてタイマーはキャンセルされるはず
    const second = await acquirePdfDocument(file, VALID_SRC);
    expect(second.ok).toBeTrue();
    if (!second.ok) return;

    // 同じentry（同じPDFDocumentProxy）が再利用されている
    expect(second.value.document).toBe(first.value.document);
    // getDocumentは初回の1回だけ
    expect(getDocumentMock).toHaveBeenCalledTimes(1);

    // タイマーがキャンセル済みのため、たとえコールバックを発火してもdestroyは呼ばれない
    // （clearDisposeTimerによりentry.disposeTimerがundefinedになるが、setTimeoutのフェイクは
    // 登録された関数への参照をそのまま保持しているので、発火させてガード条件を検証する）
    if (timers.length > 0) fireLatestTimer();
    await Promise.resolve();
    await Promise.resolve();
    expect(doc.destroy).not.toHaveBeenCalled();

    second.value.release();
  });

  it('loadDocumentが失敗（getDocument().promiseがreject）した場合、acquireはFailureを返し、次回は再試行される', async () => {
    const file = makeFile();
    getDocumentMock.mockImplementationOnce(() => ({
      promise: Promise.reject(new Error('load failed')),
    }));

    const res = await acquirePdfDocument(file, VALID_SRC);
    expect(res.ok).toBeFalse();
    if (res.ok) return;
    expect(res.error.message).toBe('load failed');

    // キャッシュに残らないため、次回同じファイルをacquireするとgetDocumentが再度呼ばれる
    const retry = await acquirePdfDocument(file, VALID_SRC);
    expect(getDocumentMock).toHaveBeenCalledTimes(2);
    expect(retry.ok).toBeTrue();
    if (retry.ok) retry.value.release();
  });

  it('不正なbase64の場合もFailureを返し、getDocumentは呼ばれない', async () => {
    const file = makeFile();
    const invalidSrc = '!!!not-base64!!!' as DocumentSource;

    const res = await acquirePdfDocument(file, invalidSrc);
    expect(res.ok).toBeFalse();
    expect(getDocumentMock).not.toHaveBeenCalled();
  });

  it('invalidatePdfDocument: 参照者がいない状態で呼ぶと即座にdestroy()が呼ばれる', async () => {
    const file = makeFile();
    const acquired = await acquirePdfDocument(file, VALID_SRC);
    expect(acquired.ok).toBeTrue();
    if (!acquired.ok) return;

    const doc = acquired.value.document as unknown as ReturnType<typeof buildFakePdfDocument>;
    acquired.value.release();
    // releaseにより破棄猶予タイマーが積まれているが、まだ発火させていない
    expect(timers).toHaveLength(1);

    invalidatePdfDocument(file);
    await Promise.resolve();
    await Promise.resolve();

    expect(doc.destroy).toHaveBeenCalledTimes(1);
  });

  it('invalidatePdfDocument: 参照者がいる状態で呼ぶと、その時点ではdestroyされず最後のrelease()時に破棄される', async () => {
    const file = makeFile();
    const acquired = await acquirePdfDocument(file, VALID_SRC);
    expect(acquired.ok).toBeTrue();
    if (!acquired.ok) return;

    const doc = acquired.value.document as unknown as ReturnType<typeof buildFakePdfDocument>;

    invalidatePdfDocument(file);
    await Promise.resolve();
    expect(doc.destroy).not.toHaveBeenCalled();

    // 最後の参照が返却された時点で破棄される（scheduleDisposeを経由しない即時破棄）
    acquired.value.release();
    await Promise.resolve();
    await Promise.resolve();
    expect(doc.destroy).toHaveBeenCalledTimes(1);

    // stale化による即時破棄なので、破棄猶予タイマーは登録されないはず
    expect(timers).toHaveLength(0);
  });

  it('invalidatePdfDocument後の次回acquireは新しいentry（getDocumentが再度呼ばれる）になる', async () => {
    const file = makeFile();
    const first = await acquirePdfDocument(file, VALID_SRC);
    expect(first.ok).toBeTrue();
    if (!first.ok) return;
    first.value.release();
    fireLatestTimer();
    await Promise.resolve();
    await Promise.resolve();

    // 改めて同ファイルをacquireしてから無効化する
    const second = await acquirePdfDocument(file, VALID_SRC);
    expect(second.ok).toBeTrue();
    if (!second.ok) return;

    invalidatePdfDocument(file);
    second.value.release();
    await Promise.resolve();
    await Promise.resolve();

    const third = await acquirePdfDocument(file, VALID_SRC);
    expect(getDocumentMock).toHaveBeenCalledTimes(3);
    if (third.ok) third.value.release();
  });
});
