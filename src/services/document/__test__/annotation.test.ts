import { describe, expect, it, mock } from 'bun:test';
import type { ContainerElementFile, ContainerID } from 'src/models/container';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import type { Result } from 'src/models/error/result';
import { Success, Failure } from 'src/models/error/result';
import type { AnnotationBaseAddress, AnnotationInfo } from 'src/models/relational/fileSchema';
import type { FileIdentity } from 'src/utils/document/fileKey';

/**
 * `src/repositories/db/annotation`と`src/services/container/main`をモック化し、
 * IndexedDB（Dexie）を使わずにサービス層のロジックのみを検証する
 *
 * 各mockには戻り値の型（`Promise<Result<T>>`）を明示しておく。こうすることで
 * 個別テストの`mockImplementationOnce`でSuccess/Failureのどちらも返せるようになる
 * （型注釈がないと最初の実装からリテラル型が固定されてしまい、後から異なる分岐を注入できない）
 */
const initAnnotDBMock = mock((): Promise<Result<void>> => Promise.resolve(Success()));
const updateAnnotationStyleMock = mock((): Promise<Result<void>> => Promise.resolve(Success()));
const getAnnotationInfoMock = mock((id: AnnotationID): Promise<Result<AnnotationInfo>> =>
  Promise.resolve(
    Success<AnnotationInfo>({
      style: baseStyle(id),
      context: { text: 'OCRで抽出済みのテキスト' },
    }),
  ),
);
const getAnnotationAddressMock = mock(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
  (_id: AnnotationID): Promise<Result<AnnotationBaseAddress>> =>
    Promise.resolve(Success<AnnotationBaseAddress>({ cID: containerID, filePath: 'doc.pdf' })),
);
const getAnnotationsByFileMock = mock(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
  (_file: ContainerElementFile): Promise<Result<AnnotationInfo[]>> =>
    Promise.resolve(Success<AnnotationInfo[]>([])),
);
const countTemporaryAnnotationsMock = mock(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
  (_file: ContainerElementFile): Promise<Result<number>> => Promise.resolve(Success(0)),
);
const getTemporaryAnnotationIdsMock = mock(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
  (_file: ContainerElementFile): Promise<Result<Set<AnnotationID>>> =>
    Promise.resolve(Success(new Set<AnnotationID>())),
);
const addAnnotationInfosMock = mock(
  (
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    _file: ContainerElementFile,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    _aInfos: AnnotationInfo[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    _isTemporary?: boolean,
  ): Promise<Result<void>> => Promise.resolve(Success()),
);
const deleteAnnotationsForFileMock = mock(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
  (_file: ContainerElementFile): Promise<Result<void>> => Promise.resolve(Success()),
);
const commitAnnotationsMock = mock(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
  (_file?: ContainerElementFile): Promise<Result<AnnotationInfo[]>> =>
    Promise.resolve(Success<AnnotationInfo[]>([])),
);
const softRemoveAnnotationMock = mock(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
  (_id: AnnotationID): Promise<Result<void>> => Promise.resolve(Success()),
);
const remapFilePathMock = mock(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
  (_cID: ContainerID, _oldPath: string, _newPath: string): Promise<Result<void>> =>
    Promise.resolve(Success()),
);
const updateAnnotationContentTextMock = mock(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
  (_id: AnnotationID, _text: string): Promise<Result<void>> => Promise.resolve(Success()),
);
const registerConfigAnnotationInfosMock = mock(
  (
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    _file: ContainerElementFile,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    _aInfos: AnnotationInfo[],
  ): Promise<Result<void>> => Promise.resolve(Success()),
);

void mock.module('src/repositories/db/annotation', () => ({
  initAnnotDB: initAnnotDBMock,
  getAnnotationInfo: getAnnotationInfoMock,
  getAnnotationAddress: getAnnotationAddressMock,
  getAnnotationsByFile: getAnnotationsByFileMock,
  countTemporaryAnnotations: countTemporaryAnnotationsMock,
  getTemporaryAnnotationIds: getTemporaryAnnotationIdsMock,
  registerConfigAnnotationInfos: registerConfigAnnotationInfosMock,
  updateAnnotationStyle: updateAnnotationStyleMock,
  addAnnotationInfos: addAnnotationInfosMock,
  deleteAnnotationsForFile: deleteAnnotationsForFileMock,
  commitAnnotations: commitAnnotationsMock,
  softRemoveAnnotation: softRemoveAnnotationMock,
  remapFilePath: remapFilePathMock,
  updateAnnotationContentText: updateAnnotationContentTextMock,
}));

// 注意: `bun test`のmock.moduleはプロセス全体で共有される（テストファイルをまたいで永続する）ため、
// 同じモジュールパスを複数のテストファイルでモックする場合は、他ファイルが必要とする関数も
// スタブとして含めておくこと（そうしないと、実行順序によって他ファイルのモックがこちらの
// スタブで上書きされ、未定義関数エラーになる）
const loadFileAsDocumentSourceMock = mock(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
  (_cID: ContainerID, _path: string): Promise<Result<string>> =>
    Promise.resolve(Failure(new Error('not used in this test'))),
);
void mock.module('src/services/container/main', () => ({
  loadFileAsDocumentSource: loadFileAsDocumentSourceMock,
  getContainer: () => Failure(new Error('not used in this test')),
}));

const getSettingsMock = mock(() => Promise.resolve(Success({ userName: undefined } as never)));
void mock.module('src/settings/main', () => ({
  getSettings: getSettingsMock,
}));

// pdfjs-distはブラウザAPI（DOMMatrix等）に依存するため、bunのテスト環境ではimportするだけで
// 失敗する。reorderAnnotationStyle/pasteAnnotationsの経路では実際には呼ばれないため、
// ダミー実装で置き換えてimport自体を回避する
const extractImageFromRegionMock = mock((): Promise<Result<string>> =>
  Promise.resolve(Failure(new Error('not used in this test'))),
);
const extractAnnotationContextPreviewMock = mock(
  (
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    _file: FileIdentity,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    _src64: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    _annotStyle: AnnotationStyle,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    _scale?: number,
  ): Promise<Result<string>> => Promise.resolve(Failure(new Error('not used in this test'))),
);
const extractTextByAnnotMock = mock((): Promise<Result<string>> =>
  Promise.resolve(Failure(new Error('not used in this test'))),
);
void mock.module('src/repositories/document/pdf', () => ({
  extractImageFromRegion: extractImageFromRegionMock,
  extractAnnotationContextPreview: extractAnnotationContextPreviewMock,
  extractTextByAnnot: extractTextByAnnotMock,
  getNumPages: () => Promise.resolve(Failure(new Error('not used in this test'))),
  getPageSize: () => Promise.resolve(Failure(new Error('not used in this test'))),
  extractTextBlocksByPage: () => Promise.resolve(Failure(new Error('not used in this test'))),
  renderPageToCanvas: () => Promise.resolve(Failure(new Error('not used in this test'))),
  getPageSizeFromDoc: () => Promise.resolve(Failure(new Error('not used in this test'))),
  extractTextBlocksByPageFromDoc: () =>
    Promise.resolve(Failure(new Error('not used in this test'))),
  renderPageToCanvasFromDoc: () => Promise.resolve(Failure(new Error('not used in this test'))),
}));

const {
  reorderAnnotationStyle,
  pasteAnnotations,
  registerAnnotationStyle,
  initAnnotDB,
  getAnnotationInfo,
  getAnnotationAddress,
  getAnnotationsByFile,
  countTemporaryAnnotations,
  getTemporaryAnnotationIds,
  registerAnnotationInfo,
  registerConfigAnnotationInfos,
  clearAnnotationsForFile,
  saveAnnotationInfo,
  removeAnnotationInfo,
  remapFilePath,
} = await import('../annotation');

const containerID = '00000000-0000-4000-8000-000000000000' as ContainerID;
const file: ContainerElementFile = {
  containerID,
  type: 'File' as const,
  path: 'doc.pdf',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  description: '',
  genre: '',
  tags: [],
};

function baseStyle(id: AnnotationID, overrides: Partial<AnnotationStyle> = {}): AnnotationStyle {
  return {
    id,
    type: 'box',
    pageNumber: 1,
    x: 0,
    y: 0,
    color: '#000000' as never,
    strokeWidth: 2,
    strokeType: 'solid',
    width: 10,
    height: 10,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    comment: {},
    ...overrides,
  } as AnnotationStyle;
}

const idA = '00000000-0000-4000-8000-000000000001' as AnnotationID;
const idB = '00000000-0000-4000-8000-000000000002' as AnnotationID;

describe('reorderAnnotationStyle', () => {
  it('registerAnnotationStyleを経由せず、既存のOCR抽出結果（context）を保持したまま返す', async () => {
    updateAnnotationStyleMock.mockClear();
    addAnnotationInfosMock.mockClear();
    getAnnotationsByFileMock.mockClear();
    getAnnotationsByFileMock.mockImplementationOnce(() =>
      Promise.resolve(
        Success<AnnotationInfo[]>([
          { style: baseStyle(idA, { zIndex: 1 }), context: { text: 'OCRで抽出済みのテキスト' } },
          { style: baseStyle(idB, { zIndex: 2 }), context: {} },
        ]),
      ),
    );

    const res = await reorderAnnotationStyle(file, idA, 'front');

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    // 既存のOCRテキストが失われず、そのまま引き継がれていること
    expect(res.value.context.text).toBe('OCRで抽出済みのテキスト');
    expect(res.value.style.zIndex).toBe(3); // front: maxKey(2) + 1

    // 新規登録用のaddAnnotationInfos（bulkPut）は呼ばれず、部分更新のみが呼ばれること
    expect(updateAnnotationStyleMock).toHaveBeenCalledTimes(1);
    expect(addAnnotationInfosMock).not.toHaveBeenCalled();
    // ロック内でDBから対象ファイルの最新一覧を読み直していること
    expect(getAnnotationsByFileMock).toHaveBeenCalledTimes(1);
  });

  it('対象の注釈が見つからない場合はFailureを返す', async () => {
    getAnnotationsByFileMock.mockClear();
    getAnnotationsByFileMock.mockImplementationOnce(() =>
      Promise.resolve(Success<AnnotationInfo[]>([{ style: baseStyle(idA), context: {} }])),
    );
    const missingId = '00000000-0000-4000-8000-000000000099' as AnnotationID;
    const res = await reorderAnnotationStyle(file, missingId, 'front');
    expect(res.ok).toBeFalse();
  });
});

describe('registerAnnotationStyle (author自動補完)', () => {
  it('authorが未指定の場合、AppSettings.userNameで補完される', async () => {
    getSettingsMock.mockClear();
    getSettingsMock.mockImplementationOnce(() =>
      Promise.resolve(Success({ userName: 'テスト太郎' } as never)),
    );

    const res = await registerAnnotationStyle(file, baseStyle(idA));
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.style.author).toBe('テスト太郎');
  });

  it('authorが既に設定されている場合は上書きしない（プラグイン実行側が事前設定したものを尊重する。getSettings自体呼ばれない）', async () => {
    getSettingsMock.mockClear();

    const res = await registerAnnotationStyle(
      file,
      baseStyle(idA, { author: 'ページ番号スタンパー' }),
    );
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.style.author).toBe('ページ番号スタンパー');
    expect(getSettingsMock).not.toHaveBeenCalled();
  });

  it('userNameが未登録の場合、authorはundefinedのままになる', async () => {
    getSettingsMock.mockClear();
    getSettingsMock.mockImplementationOnce(() =>
      Promise.resolve(Success({ userName: undefined } as never)),
    );

    const res = await registerAnnotationStyle(file, baseStyle(idA));
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.style.author).toBeUndefined();
  });
});

describe('pasteAnnotations', () => {
  it('複製した注釈のzIndexをリセットし、元の重ね順キーと衝突しないようにする', async () => {
    addAnnotationInfosMock.mockClear();

    const sources = [baseStyle(idA, { zIndex: 5 })];
    const res = await pasteAnnotations(file, sources, 1, { dx: 20, dy: 40 });

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toHaveLength(1);
    const pasted = res.value[0]?.style;
    expect(pasted?.zIndex).toBeUndefined();
    expect(pasted?.id).not.toBe(idA);
    expect(pasted?.x).toBe(sources[0]!.x + 20);
    expect(pasted?.y).toBe(sources[0]!.y + 40);

    expect(addAnnotationInfosMock).toHaveBeenCalledTimes(1);
  });

  it('複数件を複製する場合も、DB書き込み（addAnnotationInfos）は1回にまとめて行う（1件ずつ書き込むと画面に段階的に表示されてしまうため）', async () => {
    addAnnotationInfosMock.mockClear();

    const sources = [baseStyle(idA, { zIndex: 1 }), baseStyle(idB, { zIndex: 2 })];
    const res = await pasteAnnotations(file, sources, 1, { dx: 5, dy: 5 });

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toHaveLength(2);

    // 2件複製しても、DBへの書き込みは1回だけ（1回の呼び出しに2件分がまとめて渡される）
    expect(addAnnotationInfosMock).toHaveBeenCalledTimes(1);
    expect(addAnnotationInfosMock.mock.calls[0]?.[1]).toHaveLength(2);
  });
});

describe('annotationRepositoryへの単純な委譲関数', () => {
  it('initAnnotDBはannotationRepository.initAnnotDBへ委譲し、返り値をそのまま返す', async () => {
    initAnnotDBMock.mockClear();

    const res = await initAnnotDB();

    expect(initAnnotDBMock).toHaveBeenCalledTimes(1);
    expect(res.ok).toBeTrue();
  });

  it('getAnnotationInfoはannotIDを渡して委譲し、返り値をそのまま返す', async () => {
    getAnnotationInfoMock.mockClear();

    const res = await getAnnotationInfo(idA);

    expect(getAnnotationInfoMock).toHaveBeenCalledTimes(1);
    expect(getAnnotationInfoMock.mock.calls[0]?.[0]).toBe(idA);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.style.id).toBe(idA);
  });

  it('getAnnotationAddressはannotIDを渡して委譲し、返り値をそのまま返す', async () => {
    getAnnotationAddressMock.mockClear();

    const res = await getAnnotationAddress(idA);

    expect(getAnnotationAddressMock).toHaveBeenCalledTimes(1);
    expect(getAnnotationAddressMock.mock.calls[0]?.[0]).toBe(idA);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toEqual({ cID: containerID, filePath: 'doc.pdf' });
  });

  it('getAnnotationsByFileはfileを渡して委譲し、返り値をそのまま返す', async () => {
    getAnnotationsByFileMock.mockClear();

    const res = await getAnnotationsByFile(file);

    expect(getAnnotationsByFileMock).toHaveBeenCalledTimes(1);
    expect(getAnnotationsByFileMock.mock.calls[0]?.[0]).toBe(file);
    expect(res.ok).toBeTrue();
  });

  it('countTemporaryAnnotationsはfileを渡して委譲し、返り値をそのまま返す', async () => {
    countTemporaryAnnotationsMock.mockClear();

    const res = await countTemporaryAnnotations(file);

    expect(countTemporaryAnnotationsMock).toHaveBeenCalledTimes(1);
    expect(countTemporaryAnnotationsMock.mock.calls[0]?.[0]).toBe(file);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toBe(0);
  });

  it('getTemporaryAnnotationIdsはfileを渡して委譲し、返り値をそのまま返す', async () => {
    getTemporaryAnnotationIdsMock.mockClear();
    getTemporaryAnnotationIdsMock.mockImplementationOnce(() =>
      Promise.resolve(Success(new Set([idA]))),
    );

    const res = await getTemporaryAnnotationIds(file);

    expect(getTemporaryAnnotationIdsMock).toHaveBeenCalledTimes(1);
    expect(getTemporaryAnnotationIdsMock.mock.calls[0]?.[0]).toBe(file);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.has(idA)).toBeTrue();
  });

  it('registerAnnotationInfoはaddAnnotationInfosへ引数をそのまま渡して委譲する', async () => {
    addAnnotationInfosMock.mockClear();

    const infos: AnnotationInfo[] = [{ style: baseStyle(idA), context: {} }];
    const res = await registerAnnotationInfo(infos, file, false);

    expect(addAnnotationInfosMock).toHaveBeenCalledTimes(1);
    expect(addAnnotationInfosMock.mock.calls[0]).toEqual([file, infos, false]);
    expect(res.ok).toBeTrue();
  });

  it('registerConfigAnnotationInfosはfile・aInfoをそのまま渡して委譲する', async () => {
    registerConfigAnnotationInfosMock.mockClear();

    const infos: AnnotationInfo[] = [{ style: baseStyle(idA), context: {} }];
    const res = await registerConfigAnnotationInfos(file, infos);

    expect(registerConfigAnnotationInfosMock).toHaveBeenCalledTimes(1);
    expect(registerConfigAnnotationInfosMock.mock.calls[0]).toEqual([file, infos]);
    expect(res.ok).toBeTrue();
  });

  it('clearAnnotationsForFileはdeleteAnnotationsForFileへ委譲する', async () => {
    deleteAnnotationsForFileMock.mockClear();

    const res = await clearAnnotationsForFile(file);

    expect(deleteAnnotationsForFileMock).toHaveBeenCalledTimes(1);
    expect(deleteAnnotationsForFileMock.mock.calls[0]?.[0]).toBe(file);
    expect(res.ok).toBeTrue();
  });

  it('saveAnnotationInfoはcommitAnnotationsへ委譲し、返り値をそのまま返す', async () => {
    commitAnnotationsMock.mockClear();

    const res = await saveAnnotationInfo(file);

    expect(commitAnnotationsMock).toHaveBeenCalledTimes(1);
    expect(commitAnnotationsMock.mock.calls[0]?.[0]).toBe(file);
    expect(res.ok).toBeTrue();
  });

  it('removeAnnotationInfoはsoftRemoveAnnotationへannotIDを渡して委譲する', async () => {
    softRemoveAnnotationMock.mockClear();

    const res = await removeAnnotationInfo(idA);

    expect(softRemoveAnnotationMock).toHaveBeenCalledTimes(1);
    expect(softRemoveAnnotationMock.mock.calls[0]?.[0]).toBe(idA);
    expect(res.ok).toBeTrue();
  });

  it('remapFilePathはcontainerID・旧パス・新パスをそのまま渡して委譲する', async () => {
    remapFilePathMock.mockClear();

    const res = await remapFilePath(containerID, 'old.pdf', 'new.pdf');

    expect(remapFilePathMock).toHaveBeenCalledTimes(1);
    expect(remapFilePathMock.mock.calls[0]).toEqual([containerID, 'old.pdf', 'new.pdf']);
    expect(res.ok).toBeTrue();
  });
});

describe('registerAnnotationStyleにおけるコンテンツ再読み込みの発火（ジオメトリ変化判定）', () => {
  it('新規アノテーション（previousが見つからない）の場合、必ずコンテンツ読み込みが発火する', async () => {
    getAnnotationInfoMock.mockClear();
    loadFileAsDocumentSourceMock.mockClear();
    extractTextByAnnotMock.mockClear();
    extractImageFromRegionMock.mockClear();
    updateAnnotationContentTextMock.mockClear();

    // previous取得を失敗させることで「新規アノテーション」扱いにする
    getAnnotationInfoMock.mockImplementationOnce(() =>
      Promise.resolve(Failure(new Error('not found'))),
    );
    loadFileAsDocumentSourceMock.mockImplementationOnce(() =>
      Promise.resolve(Success('dummy-source' as never)),
    );
    extractTextByAnnotMock.mockImplementationOnce(() =>
      Promise.resolve(Success('直接抽出されたテキスト')),
    );

    const res = await registerAnnotationStyle(file, baseStyle(idA));
    expect(res.ok).toBeTrue();

    // `void loadAnnotContent(...)`は投げっぱなしのfire-and-forgetのため、マイクロタスクをフラッシュしてから検証する
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(loadFileAsDocumentSourceMock).toHaveBeenCalledTimes(1);
    expect(extractTextByAnnotMock).toHaveBeenCalledTimes(1);
    // PDFにテキストが直接含まれていたため、画像OCR抽出は呼ばれない
    expect(extractImageFromRegionMock).not.toHaveBeenCalled();
    expect(updateAnnotationContentTextMock).toHaveBeenCalledWith(idA, '直接抽出されたテキスト');
  });

  it('直接テキスト抽出が空文字列の場合、画像からのOCR抽出処理が呼ばれる', async () => {
    getAnnotationInfoMock.mockClear();
    loadFileAsDocumentSourceMock.mockClear();
    extractTextByAnnotMock.mockClear();
    extractImageFromRegionMock.mockClear();
    updateAnnotationContentTextMock.mockClear();

    getAnnotationInfoMock.mockImplementationOnce(() =>
      Promise.resolve(Failure(new Error('not found'))),
    );
    loadFileAsDocumentSourceMock.mockImplementationOnce(() =>
      Promise.resolve(Success('dummy-source' as never)),
    );
    extractTextByAnnotMock.mockImplementationOnce(() => Promise.resolve(Success('')));
    extractImageFromRegionMock.mockImplementationOnce(() =>
      Promise.resolve(Failure(new Error('image extraction failed'))),
    );

    const res = await registerAnnotationStyle(file, baseStyle(idB));
    expect(res.ok).toBeTrue();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(extractImageFromRegionMock).toHaveBeenCalledTimes(1);
    // 画像化・OCR処理が失敗した場合は空文字列がコンテンツとして格納される
    expect(updateAnnotationContentTextMock).toHaveBeenCalledWith(idB, '');
  });

  it('ジオメトリが変化した場合、再読込が完了するまでcontext.textは未読み込み（undefined）として即座に反映される', async () => {
    getAnnotationInfoMock.mockClear();
    loadFileAsDocumentSourceMock.mockClear();
    addAnnotationInfosMock.mockClear();

    // 直前は既存のOCR結果を持っていたアノテーション
    getAnnotationInfoMock.mockImplementationOnce(() =>
      Promise.resolve(
        Success<AnnotationInfo>({
          style: baseStyle(idA),
          context: { text: '移動前の古いOCR結果' },
        }),
      ),
    );
    // 再読込自体は待たず、即座に返る戻り値だけを検証する（実際のOCR結果を待たない）
    loadFileAsDocumentSourceMock.mockImplementationOnce(() => new Promise<never>(() => undefined));

    // 位置（x）を変更＝ジオメトリ変化
    const movedStyle = baseStyle(idA, { x: 100 });
    const res = await registerAnnotationStyle(file, movedStyle);

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    // 古いOCR結果を引き継がず、再読込完了までは未読み込み扱いになる
    expect(res.value.context.text).toBeUndefined();
    // DBへ保存される内容も同様にundefinedであること
    expect(addAnnotationInfosMock).toHaveBeenCalledTimes(1);
    expect(addAnnotationInfosMock.mock.calls[0]?.[1]?.[0]?.context.text).toBeUndefined();
    // 再読込自体は実際に発火していること
    expect(loadFileAsDocumentSourceMock).toHaveBeenCalledTimes(1);
    expect(loadFileAsDocumentSourceMock).toHaveBeenCalledWith(file.containerID, file.path);
  });

  it('ジオメトリ（ページ番号・外接矩形）が変化していない場合、コンテンツ読み込みは発火しない', async () => {
    getAnnotationInfoMock.mockClear();
    loadFileAsDocumentSourceMock.mockClear();
    extractTextByAnnotMock.mockClear();
    extractImageFromRegionMock.mockClear();

    const style = baseStyle(idA);

    // 直前に保存されたアノテーションとして、同一のstyleを持つ既存情報を返す
    getAnnotationInfoMock.mockImplementationOnce(() =>
      Promise.resolve(Success<AnnotationInfo>({ style, context: { text: '既存テキスト' } })),
    );

    const res = await registerAnnotationStyle(file, style);
    expect(res.ok).toBeTrue();

    await new Promise((resolve) => setTimeout(resolve, 0));

    // ページ番号・外接矩形が変わっていないため、内容の再読み込みは発火しない
    expect(loadFileAsDocumentSourceMock).not.toHaveBeenCalled();
    expect(extractTextByAnnotMock).not.toHaveBeenCalled();
    expect(extractImageFromRegionMock).not.toHaveBeenCalled();
  });

  it('短時間に連続してジオメトリが変化した場合、先に始まった（遅い）読み込みが後から完了しても、後発（最新）の読み込み結果を上書きしない', async () => {
    getAnnotationInfoMock.mockClear();
    loadFileAsDocumentSourceMock.mockClear();
    extractTextByAnnotMock.mockClear();
    updateAnnotationContentTextMock.mockClear();

    // 1回目（遅い）：サイズ変更直後の読み込み。手動でresolveするまでファイル取得が完了しない
    getAnnotationInfoMock.mockImplementationOnce(() =>
      Promise.resolve(Failure(new Error('not found'))),
    );
    let resolveSlowSource: (value: Result<string>) => void = () => undefined;
    const slowSource = new Promise<Result<string>>((resolve) => {
      resolveSlowSource = resolve;
    });
    loadFileAsDocumentSourceMock.mockImplementationOnce(() => slowSource);

    const firstStyle = baseStyle(idA, { width: 20 });
    const firstRegister = registerAnnotationStyle(file, firstStyle);
    // 1回目の呼び出しがloadFileAsDocumentSourceの完了待ちに入るまでマイクロタスクをフラッシュする
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 2回目（速い）：さらに微調整した直後の読み込み。即座に完了する
    getAnnotationInfoMock.mockImplementationOnce(() =>
      Promise.resolve(Success<AnnotationInfo>({ style: firstStyle, context: { text: undefined } })),
    );
    loadFileAsDocumentSourceMock.mockImplementationOnce(() =>
      Promise.resolve(Success('dummy-source' as never)),
    );
    extractTextByAnnotMock.mockImplementationOnce(() => Promise.resolve(Success('最新の値')));

    const secondStyle = baseStyle(idA, { width: 30 });
    await registerAnnotationStyle(file, secondStyle);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 2回目（最新）の読み込みが先に完了し、DBに反映される
    expect(updateAnnotationContentTextMock).toHaveBeenCalledWith(idA, '最新の値');
    const writeCountAfterSecond = updateAnnotationContentTextMock.mock.calls.length;

    // その後、1回目（古い）の読み込みが遅れて完了する
    extractTextByAnnotMock.mockImplementationOnce(() => Promise.resolve(Success('古い値')));
    resolveSlowSource(Success('dummy-source' as never));
    await firstRegister;
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 古い読み込みの結果が後から書き込まれ、最新の値を上書きしてしまわないこと
    expect(updateAnnotationContentTextMock).toHaveBeenCalledTimes(writeCountAfterSecond);
    expect(updateAnnotationContentTextMock).not.toHaveBeenCalledWith(idA, '古い値');
  });
});
