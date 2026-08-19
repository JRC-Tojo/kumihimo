import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type {
  Container,
  ContainerElementFile,
  ContainerID,
  ContainerSkel,
} from 'src/models/container';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import type { AnnotationGroupID } from 'src/models/document/group';
import type { Result } from 'src/models/error/result';
import { Failure, NotFoundError, Success } from 'src/models/error/result';
import type {
  AnnotationBaseAddress,
  AnnotationInfo,
  CachedRelationalFile,
  DocumentConfigFile,
  RelationalRule,
} from 'src/models/relational/fileSchema';
import type { Relational, RelationalWithAddress } from 'src/models/relational/common';
import type { ContainerSettingsFile } from 'src/models/relational/containerSettings';
import type { RelaxationOptions } from 'src/models/relational/relaxation';

/**
 * `src/services/document/annotation`・`src/services/container/main`・
 * `src/services/container/config`・`src/repositories/db/relational`をモック化し、
 * IndexedDB/OCR/実際のコンテナストレージ等を使わずにサービス層のロジックのみを検証する
 */
const containerID = '00000000-0000-4000-8000-000000000000' as ContainerID;
const idSrc = '00000000-0000-4000-8000-000000000001' as AnnotationID;
const idTarget = '00000000-0000-4000-8000-000000000002' as AnnotationID;
const filePath = 'doc.pdf';

// 緩和ルールがすべて無効なベースライン（既定値はすべて有効なため、1項目だけを検証する
// テストではここから明示的に有効化して使う）
const NO_RELAXATION: RelaxationOptions = {
  ignoreCase: false,
  ignoreWhitespace: false,
  ignoreWidth: false,
  numericEquivalence: false,
  equivalenceGroups: [],
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

// annotIDごとのOCR抽出値。各テストの冒頭で書き換えてから使う
const contentByAnnotId = new Map<AnnotationID, string>();
// 「セッション中に未読み込み」（.kcfgフォールバックが必要）を模擬するID集合
const failedCachedLookupIds = new Set<AnnotationID>();
// content.textが読み込み中（undefined）であることを模擬するID集合
const pendingAnnotIds = new Set<AnnotationID>();
// アノテーションとしては一切存在しない（＝グループIDである）ことを模擬するID集合。
// NotFoundErrorを返すことで、relational.ts側のグループへのフォールバック解決を発火させる
const notAnAnnotationIds = new Set<AnnotationID>();

const getAnnotationInfoMock = mock((id: AnnotationID): Promise<Result<AnnotationInfo>> => {
  if (notAnAnnotationIds.has(id)) {
    return Promise.resolve(Failure(new NotFoundError('annotation not found')));
  }
  if (failedCachedLookupIds.has(id)) {
    return Promise.resolve(Failure(new Error('not cached in this session')));
  }
  return Promise.resolve(
    Success<AnnotationInfo>({
      style: baseStyle(id),
      context: { text: pendingAnnotIds.has(id) ? undefined : (contentByAnnotId.get(id) ?? '') },
    }),
  );
});
const getAnnotationAddressMock = mock((id: AnnotationID): Promise<Result<AnnotationBaseAddress>> =>
  Promise.resolve(
    notAnAnnotationIds.has(id)
      ? Failure(new NotFoundError('annotation not found'))
      : Success<AnnotationBaseAddress>({ cID: containerID, filePath }),
  ),
);
const registerAnnotationInfoMock = mock((): Promise<Result<void>> => Promise.resolve(Success()));

void mock.module('src/services/document/annotation', () => ({
  getAnnotationInfo: getAnnotationInfoMock,
  getAnnotationAddress: getAnnotationAddressMock,
  registerAnnotationInfo: registerAnnotationInfoMock,
}));

// `relational.ts`は`annotationGroup`サービス経由でグループを端点とする関係性を解決する
// （→ importすると`config.ts`経由でpdf.js等の重い依存も引き込むため、モック化して遮断する）。
// 各テストの冒頭でgroupRecordFixtureを設定することで、対象IDがグループとして解決される
// ケースを模擬できる。未設定（undefined）の場合はグループとしても見つからない（NotFoundError）
let groupRecordFixture:
  | {
      address: AnnotationBaseAddress;
      memberIds: AnnotationID[];
      valueAggregation?: { type: 'sum' };
    }
  | undefined;
const getGroupAddressMock = mock((): Promise<Result<AnnotationBaseAddress>> =>
  Promise.resolve(
    groupRecordFixture !== undefined
      ? Success(groupRecordFixture.address)
      : Failure(new NotFoundError('annotation group not found')),
  ),
);
const getGroupRecordMock = mock(
  (): Promise<
    Result<{
      address: AnnotationBaseAddress;
      memberIds: AnnotationID[];
      valueAggregation?: { type: 'sum' };
    }>
  > =>
    Promise.resolve(
      groupRecordFixture !== undefined
        ? Success(groupRecordFixture)
        : Failure(new NotFoundError('annotation group not found')),
    ),
);
void mock.module('src/services/document/annotationGroup', () => ({
  getGroupAddress: getGroupAddressMock,
  getGroupRecord: getGroupRecordMock,
}));

// コンテナ本体（getContainer/loadContainerの戻り値）。各テストの冒頭で書き換える
let containerFixture: Container | ContainerSkel | undefined;
const getContainerMock = mock(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
  (_id: ContainerID): Result<Container | ContainerSkel> =>
    containerFixture !== undefined
      ? Success(containerFixture)
      : Failure(new Error('container not found')),
);
const loadContainerMock = mock(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
  (_id: ContainerID): Promise<Result<Container>> =>
    Promise.resolve(
      containerFixture !== undefined && 'elements' in containerFixture
        ? Success(containerFixture)
        : Failure(new Error('container not loaded')),
    ),
);
void mock.module('src/services/container/main', () => ({
  getContainer: getContainerMock,
  loadContainer: loadContainerMock,
}));

// コンテナ設定ファイル（.kumihimo/settings.json）側の緩和ルール。各テストの冒頭で書き換えてから使う
let containerRelaxation: RelaxationOptions = NO_RELAXATION;
// trueにすると、コンテナ設定ファイルの取得自体が失敗するケースを模擬できる
let containerSettingsShouldFail = false;
// コンテナルートの関係性キャッシュ（.kumihimo/relational.json）。各テストの冒頭で書き換える
let cachedRelationalFileFixture: CachedRelationalFile = { annotIdToFileInfo: {}, relationals: [] };
// 文書設定ファイル（.kcfg）フォールバック用フィクスチャ
let documentConfigFileFixture: DocumentConfigFile | undefined;

const getContainerSettingsFileMock = mock((): Promise<Result<ContainerSettingsFile>> =>
  Promise.resolve(
    containerSettingsShouldFail
      ? Failure(new Error('container settings file not readable'))
      : Success({ relationalRelaxation: containerRelaxation }),
  ),
);
const getRelationalFileMock = mock(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
  (_cID: ContainerID): Promise<Result<CachedRelationalFile>> =>
    Promise.resolve(Success(cachedRelationalFileFixture)),
);
const getDocumentConfigFileMock = mock((): Promise<Result<DocumentConfigFile>> =>
  Promise.resolve(
    documentConfigFileFixture !== undefined
      ? Success(documentConfigFileFixture)
      : Failure(new Error('config file not found')),
  ),
);
void mock.module('src/services/container/config', () => ({
  getContainerSettingsFile: getContainerSettingsFileMock,
  getRelationalFile: getRelationalFileMock,
  getDocumentConfigFile: getDocumentConfigFileMock,
}));

const initRelationalDBMock = mock((): Promise<Result<void>> => Promise.resolve(Success()));
const addCachedRelationalsMock = mock(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
  (_rs: RelationalWithAddress[]): Promise<Result<void>> => Promise.resolve(Success()),
);
const getRelationalsByFileMock = mock(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
  (_file: ContainerElementFile): Promise<Result<Relational[]>> => Promise.resolve(Success([])),
);
const getRelationalsInvolvingFileMock = mock(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
  (_file: ContainerElementFile): Promise<Result<RelationalWithAddress[]>> =>
    Promise.resolve(Success([])),
);
const countTemporaryRelationalsInvolvingFileMock = mock(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
  (_file: ContainerElementFile): Promise<Result<number>> => Promise.resolve(Success(0)),
);
const remapFilePathRepoMock = mock(
  (
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    _cID: ContainerID,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    _oldPath: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    _newPath: string,
  ): Promise<Result<void>> => Promise.resolve(Success()),
);
const addRelationalMock = mock(
  (
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    _r: Relational,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    _src: AnnotationBaseAddress,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    _tgt: AnnotationBaseAddress,
  ): Promise<Result<void>> => Promise.resolve(Success()),
);
const softRemoveRelationalsBySrcIDMock = mock(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
  (_srcID: string): Promise<Result<void>> => Promise.resolve(Success()),
);
const softRemoveRelationalEdgeMock = mock(
  (
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    _srcID: AnnotationID,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
    _targetID: AnnotationID,
  ): Promise<Result<void>> => Promise.resolve(Success()),
);
const softRemoveRelationalsByAnnotationIDMock = mock(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
  (_annotID: AnnotationID): Promise<Result<void>> => Promise.resolve(Success()),
);
const deleteRelationalsInvolvingFileMock = mock(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
  (_file: ContainerElementFile): Promise<Result<void>> => Promise.resolve(Success()),
);
const commitRelationalsMock = mock(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
  (_file: ContainerElementFile): Promise<Result<RelationalWithAddress[]>> =>
    Promise.resolve(Success([])),
);

void mock.module('src/repositories/db/relational', () => ({
  initRelationalDB: initRelationalDBMock,
  addCachedRelationals: addCachedRelationalsMock,
  getRelationalsByFile: getRelationalsByFileMock,
  getRelationalsInvolvingFile: getRelationalsInvolvingFileMock,
  countTemporaryRelationalsInvolvingFile: countTemporaryRelationalsInvolvingFileMock,
  remapFilePath: remapFilePathRepoMock,
  addRelational: addRelationalMock,
  softRemoveRelationalsBySrcID: softRemoveRelationalsBySrcIDMock,
  softRemoveRelationalEdge: softRemoveRelationalEdgeMock,
  softRemoveRelationalsByAnnotationID: softRemoveRelationalsByAnnotationIDMock,
  deleteRelationalsInvolvingFile: deleteRelationalsInvolvingFileMock,
  commitRelationals: commitRelationalsMock,
}));

const {
  initRelationalDB,
  loadRelationals,
  getRelationals,
  checkRelational,
  checkRelationalSafe,
  registRelational,
  getRelationalsInvolvingFile,
  countTemporaryRelationalsInvolvingFile,
  getReferencedFilePaths,
  removeRelationals,
  removeRelationalEdge,
  removeRelationalsForAnnotation,
  resolveAnnotationFile,
  getAnnotationPageNumber,
  saveRelationals,
  discardUnsavedRelationalsInvolvingFile,
  remapFilePath,
  invalidateContainerRelaxationCache,
} = await import('../relational');

// resolveRelaxationOptions内のコンテナ単位キャッシュはモジュールスコープで保持されるため、
// テストをまたいで古い緩和ルールが残らないよう毎回破棄してから実行する
beforeEach(() => {
  invalidateContainerRelaxationCache(containerID);
});

const dummyAddress: AnnotationBaseAddress = { cID: containerID, filePath };

function buildRequest(rule: RelationalRule): RelationalWithAddress {
  return {
    relational: { srcID: idSrc, targetID: idTarget, rule },
    srcAddress: dummyAddress,
    targetAddress: dummyAddress,
  };
}

const file: ContainerElementFile = {
  containerID,
  type: 'File',
  path: filePath,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  description: '',
  genre: '',
  tags: [],
};

const containerSkelFixture: ContainerSkel = {
  id: containerID,
  name: 'container',
  type: 'local',
  containerPath: '/root',
};
const containerWithElementsFixture: Container = {
  ...containerSkelFixture,
  elements: { [filePath]: file },
};

describe('checkRelational', () => {
  it('緩和ルールが無効な場合は完全一致のみOKになる', async () => {
    containerRelaxation = NO_RELAXATION;
    contentByAnnotId.set(idSrc, 'ABC');
    contentByAnnotId.set(idTarget, 'abc');

    const res = await checkRelational(buildRequest({ type: 'equal' }));
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.checkedRule?.isOK).toBe(false);
  });

  it('コンテナ設定側の緩和ルール（ignoreCase）が既定値として反映される', async () => {
    containerRelaxation = { ...NO_RELAXATION, ignoreCase: true };
    contentByAnnotId.set(idSrc, 'ABC');
    contentByAnnotId.set(idTarget, 'abc');

    const res = await checkRelational(buildRequest({ type: 'equal' }));
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.checkedRule?.isOK).toBe(true);
  });

  it('コンテナ設定ファイルの取得に失敗した場合は既定の緩和ルール（すべて有効）にフォールバックする', async () => {
    containerSettingsShouldFail = true;
    // 既定の緩和ルールはignoreCase等がすべて有効なため、大文字小文字違いでもOKになる
    contentByAnnotId.set(idSrc, 'ABC');
    contentByAnnotId.set(idTarget, 'abc');

    const res = await checkRelational(buildRequest({ type: 'equal' }));
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.checkedRule?.isOK).toBe(true);

    containerSettingsShouldFail = false;
  });

  it('numericEquivalence: 表記が異なっても数値として同じ値なら一致する（例：「8」と「8.000」）', async () => {
    containerRelaxation = { ...NO_RELAXATION, numericEquivalence: true };
    contentByAnnotId.set(idSrc, '8');
    contentByAnnotId.set(idTarget, '8.000');

    const res = await checkRelational(buildRequest({ type: 'equal' }));
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.checkedRule?.isOK).toBe(true);
  });

  it('アノテーション別のrelaxationはコンテナ設定を完全に上書きする（マージしない）', async () => {
    // コンテナ設定はignoreCase:trueだが、アノテーション別の上書きにはignoreCaseを含めない
    containerRelaxation = { ...NO_RELAXATION, ignoreCase: true };
    contentByAnnotId.set(idSrc, 'ABC');
    contentByAnnotId.set(idTarget, 'abc');

    const res = await checkRelational(
      buildRequest({
        type: 'equal',
        relaxation: { ...NO_RELAXATION, ignoreWhitespace: true },
      }),
    );
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    // ignoreCaseはコンテナ設定にのみ存在し、上書き設定には引き継がれないためNGになる
    expect(res.value.checkedRule?.isOK).toBe(false);
  });

  it('srcFormulaを自身の値に適用してから比較する（表示用の値は生値のまま）', async () => {
    containerRelaxation = NO_RELAXATION;
    contentByAnnotId.set(idSrc, '100');
    contentByAnnotId.set(idTarget, '109');

    const res = await checkRelational(buildRequest({ type: 'equal', srcFormula: 'x + 9' }));
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.checkedRule?.isOK).toBe(true);
    expect(res.value.srcVal).toBe('100');
    expect(res.value.targetVal).toBe('109');
  });

  it('自身の値が数値化できない場合は計算を適用せず生値のまま比較する', async () => {
    containerRelaxation = NO_RELAXATION;
    contentByAnnotId.set(idSrc, 'N/A');
    contentByAnnotId.set(idTarget, 'N/A');

    const res = await checkRelational(buildRequest({ type: 'equal', srcFormula: 'x + 9' }));
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.checkedRule?.isOK).toBe(true);
  });

  it('constValは比較に一切影響しない（未使用フィールド）', async () => {
    containerRelaxation = NO_RELAXATION;
    contentByAnnotId.set(idSrc, 'X');
    contentByAnnotId.set(idTarget, 'Y');

    const res = await checkRelational(buildRequest({ type: 'equal', constVal: 'X' }));
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.checkedRule?.isOK).toBe(false);
  });

  it('linkルールは値に関わらず常にOKになる', async () => {
    contentByAnnotId.set(idSrc, 'foo');
    contentByAnnotId.set(idTarget, 'bar');

    const res = await checkRelational(buildRequest({ type: 'link' }));
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.checkedRule?.isOK).toBe(true);
  });

  it('内容が未読み込み（context.text: undefined）の場合は失敗を返す', async () => {
    pendingAnnotIds.add(idSrc);
    const res = await checkRelational(buildRequest({ type: 'equal' }));
    expect(res.ok).toBeFalse();
    pendingAnnotIds.delete(idSrc);
  });
});

describe('checkRelationalSafe', () => {
  it('内容が未読み込みの場合でも失敗せず、checkedRule: undefinedを返す', async () => {
    pendingAnnotIds.add(idSrc);
    const res = await checkRelationalSafe(buildRequest({ type: 'equal' }));
    expect(res.checkedRule).toBeUndefined();
    expect(res.srcVal).toBe('');
    expect(res.targetVal).toBe('');
    pendingAnnotIds.delete(idSrc);
  });

  it('正常時はcheckRelationalと同じ結果を返す', async () => {
    containerRelaxation = NO_RELAXATION;
    contentByAnnotId.set(idSrc, 'same');
    contentByAnnotId.set(idTarget, 'same');

    const res = await checkRelationalSafe(buildRequest({ type: 'equal' }));
    expect(res.checkedRule?.isOK).toBe(true);
  });
});

describe('initRelationalDB', () => {
  it('リポジトリ層の初期化をそのまま呼び出す', async () => {
    const res = await initRelationalDB();
    expect(res.ok).toBeTrue();
  });
});

describe('loadRelationals', () => {
  it('コンテナルートの関係性ファイルを読み込み、DBキャッシュへ反映したうえでRelational一覧を返す', async () => {
    containerFixture = containerSkelFixture;
    cachedRelationalFileFixture = {
      annotIdToFileInfo: {
        [idSrc]: { cID: containerID, filePath },
        [idTarget]: { cID: containerID, filePath: 'other.pdf' },
      },
      relationals: [{ src: idSrc, target: idTarget, rule: { type: 'link' } }],
    };
    addCachedRelationalsMock.mockClear();

    const res = await loadRelationals(containerID);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toEqual([{ srcID: idSrc, targetID: idTarget, rule: { type: 'link' } }]);
    expect(addCachedRelationalsMock).toHaveBeenCalledTimes(1);
  });

  it('annotIdToFileInfoに情報が無い関係性は除外される', async () => {
    containerFixture = containerSkelFixture;
    cachedRelationalFileFixture = {
      annotIdToFileInfo: {},
      relationals: [{ src: idSrc, target: idTarget, rule: { type: 'link' } }],
    };

    const res = await loadRelationals(containerID);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toEqual([]);
  });

  it('対象コンテナが見つからない場合は失敗を返す', async () => {
    containerFixture = undefined;
    const res = await loadRelationals(containerID);
    expect(res.ok).toBeFalse();
  });
});

describe('getRelationals', () => {
  it('リポジトリ層へそのまま委譲する', async () => {
    getRelationalsByFileMock.mockClear();
    await getRelationals(file);
    expect(getRelationalsByFileMock).toHaveBeenCalledTimes(1);
  });
});

describe('registRelational', () => {
  it('src・targetのアドレスを解決し、仮登録したうえで検証結果を返す', async () => {
    containerRelaxation = NO_RELAXATION;
    contentByAnnotId.set(idSrc, 'same');
    contentByAnnotId.set(idTarget, 'same');
    addRelationalMock.mockClear();

    const res = await registRelational({
      srcID: idSrc,
      targetID: idTarget,
      rule: { type: 'equal' },
    });
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.checkedRule?.isOK).toBe(true);
    expect(addRelationalMock).toHaveBeenCalledTimes(1);
  });
});

describe('グループを端点とする関係性', () => {
  const groupId = '00000000-0000-4000-8000-0000000000aa' as AnnotationGroupID;
  const memberA = '00000000-0000-4000-8000-0000000000ab' as AnnotationID;
  const memberB = '00000000-0000-4000-8000-0000000000ac' as AnnotationID;

  it('valueAggregationが"sum"の場合、メンバーの数値を合算した値で検証する', async () => {
    containerRelaxation = NO_RELAXATION;
    notAnAnnotationIds.add(groupId as unknown as AnnotationID);
    groupRecordFixture = {
      address: dummyAddress,
      memberIds: [memberA, memberB],
      valueAggregation: { type: 'sum' },
    };
    contentByAnnotId.set(memberA, '2');
    contentByAnnotId.set(memberB, '3');
    contentByAnnotId.set(idTarget, '5');

    const res = await checkRelational({
      relational: { srcID: groupId, targetID: idTarget, rule: { type: 'equal' } },
      srcAddress: dummyAddress,
      targetAddress: dummyAddress,
    });

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.srcVal).toBe('5');
    expect(res.value.checkedRule?.isOK).toBe(true);

    notAnAnnotationIds.delete(groupId as unknown as AnnotationID);
    groupRecordFixture = undefined;
  });

  it('valueAggregationが未設定でも"link"ルールは通常通り成立する', async () => {
    notAnAnnotationIds.add(groupId as unknown as AnnotationID);
    groupRecordFixture = { address: dummyAddress, memberIds: [memberA, memberB] };

    const res = await checkRelational({
      relational: { srcID: groupId, targetID: idTarget, rule: { type: 'link' } },
      srcAddress: dummyAddress,
      targetAddress: dummyAddress,
    });

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.checkedRule?.isOK).toBe(true);

    notAnAnnotationIds.delete(groupId as unknown as AnnotationID);
    groupRecordFixture = undefined;
  });

  it('valueAggregationが未設定の場合、"equal"ルールの検証は常にNGになる', async () => {
    notAnAnnotationIds.add(groupId as unknown as AnnotationID);
    groupRecordFixture = { address: dummyAddress, memberIds: [memberA, memberB] };
    contentByAnnotId.set(idTarget, '5');

    const res = await checkRelational({
      relational: { srcID: groupId, targetID: idTarget, rule: { type: 'equal' } },
      srcAddress: dummyAddress,
      targetAddress: dummyAddress,
    });

    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.checkedRule?.isOK).toBe(false);

    notAnAnnotationIds.delete(groupId as unknown as AnnotationID);
    groupRecordFixture = undefined;
  });

  it('valueAggregationが未設定でも、registRelationalによる新規登録自体は成功する', async () => {
    notAnAnnotationIds.add(groupId as unknown as AnnotationID);
    groupRecordFixture = { address: dummyAddress, memberIds: [memberA, memberB] };
    addRelationalMock.mockClear();

    const res = await registRelational({
      srcID: groupId,
      targetID: idTarget,
      rule: { type: 'equal' },
    });

    expect(res.ok).toBeTrue();
    expect(addRelationalMock).toHaveBeenCalledTimes(1);

    notAnAnnotationIds.delete(groupId as unknown as AnnotationID);
    groupRecordFixture = undefined;
  });
});

describe('getRelationalsInvolvingFile / countTemporaryRelationalsInvolvingFile', () => {
  it('リポジトリ層へそのまま委譲する', async () => {
    await getRelationalsInvolvingFile(file);
    await countTemporaryRelationalsInvolvingFile(file);
    expect(getRelationalsInvolvingFileMock).toHaveBeenCalled();
    expect(countTemporaryRelationalsInvolvingFileMock).toHaveBeenCalled();
  });
});

describe('getReferencedFilePaths', () => {
  it('関係性キャッシュが参照するファイルパスを重複なく返す', async () => {
    cachedRelationalFileFixture = {
      annotIdToFileInfo: {
        [idSrc]: { cID: containerID, filePath: 'a.pdf' },
        [idTarget]: { cID: containerID, filePath: 'a.pdf' },
      },
      relationals: [],
    };

    const res = await getReferencedFilePaths(containerID);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toEqual(['a.pdf']);
  });
});

describe('removeRelationals / removeRelationalEdge / removeRelationalsForAnnotation', () => {
  it('リポジトリ層へそのまま委譲する', async () => {
    await removeRelationals(idSrc);
    await removeRelationalEdge(idSrc, idTarget);
    await removeRelationalsForAnnotation(idSrc);
    expect(softRemoveRelationalsBySrcIDMock).toHaveBeenCalled();
    expect(softRemoveRelationalEdgeMock).toHaveBeenCalled();
    expect(softRemoveRelationalsByAnnotationIDMock).toHaveBeenCalled();
  });
});

describe('resolveAnnotationFile', () => {
  it('アノテーションIDから所属ファイルを解決する', async () => {
    containerFixture = containerWithElementsFixture;

    const res = await resolveAnnotationFile(idSrc);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.path).toBe(filePath);
  });

  it('コンテナ内に該当ファイルが存在しない場合は失敗を返す', async () => {
    containerFixture = { ...containerWithElementsFixture, elements: {} };

    const res = await resolveAnnotationFile(idSrc);
    expect(res.ok).toBeFalse();
  });
});

describe('getAnnotationPageNumber', () => {
  it('セッション中にキャッシュ済みのアノテーション情報からページ番号を取得する', async () => {
    failedCachedLookupIds.delete(idSrc);
    const res = await getAnnotationPageNumber(idSrc);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toBe(1);
  });

  it('セッション中に未読み込みの場合は.kcfgへフォールバックしてページ番号を取得する', async () => {
    failedCachedLookupIds.add(idTarget);
    containerFixture = containerWithElementsFixture;
    documentConfigFileFixture = {
      fileHash: 'dummyhash',
      annots: {
        [idTarget]: { style: baseStyle(idTarget, { pageNumber: 3 }), context: { text: 'X' } },
      },
      bookmarks: {},
      groups: {},
      outlineImported: false,
    };

    const res = await getAnnotationPageNumber(idTarget);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value).toBe(3);

    failedCachedLookupIds.delete(idTarget);
    documentConfigFileFixture = undefined;
  });
});

describe('saveRelationals', () => {
  it('リポジトリ層のcommitRelationalsへそのまま委譲する', async () => {
    commitRelationalsMock.mockClear();
    await saveRelationals(file);
    expect(commitRelationalsMock).toHaveBeenCalledTimes(1);
  });
});

describe('discardUnsavedRelationalsInvolvingFile', () => {
  it('未保存の関係性を削除し、キャッシュから該当ファイル分のみ再登録する', async () => {
    containerFixture = containerSkelFixture;
    cachedRelationalFileFixture = {
      annotIdToFileInfo: {
        [idSrc]: { cID: containerID, filePath },
        [idTarget]: { cID: containerID, filePath: 'other.pdf' },
      },
      relationals: [{ src: idSrc, target: idTarget, rule: { type: 'link' } }],
    };
    deleteRelationalsInvolvingFileMock.mockClear();
    addCachedRelationalsMock.mockClear();

    const res = await discardUnsavedRelationalsInvolvingFile(file);
    expect(res.ok).toBeTrue();
    expect(deleteRelationalsInvolvingFileMock).toHaveBeenCalledTimes(1);
    expect(addCachedRelationalsMock).toHaveBeenCalledTimes(1);
  });

  it('該当ファイルに関わる関係性が無い場合は再登録を行わない', async () => {
    containerFixture = containerSkelFixture;
    cachedRelationalFileFixture = { annotIdToFileInfo: {}, relationals: [] };
    addCachedRelationalsMock.mockClear();

    const res = await discardUnsavedRelationalsInvolvingFile(file);
    expect(res.ok).toBeTrue();
    expect(addCachedRelationalsMock).not.toHaveBeenCalled();
  });
});

describe('remapFilePath', () => {
  it('リポジトリ層へそのまま委譲する', async () => {
    remapFilePathRepoMock.mockClear();
    await remapFilePath(containerID, 'old.pdf', 'new.pdf');
    expect(remapFilePathRepoMock).toHaveBeenCalledTimes(1);
  });
});

describe('コンテナ単位の緩和ルールのキャッシュ', () => {
  it('同一コンテナの緩和ルールは1回だけ取得し、以降の検証はキャッシュを再利用する', async () => {
    containerRelaxation = NO_RELAXATION;
    contentByAnnotId.set(idSrc, 'ABC');
    contentByAnnotId.set(idTarget, 'ABC');
    getContainerSettingsFileMock.mockClear();

    await checkRelational(buildRequest({ type: 'equal' }));
    await checkRelational(buildRequest({ type: 'equal' }));

    expect(getContainerSettingsFileMock).toHaveBeenCalledTimes(1);
  });

  it('アノテーション別のrelaxationで上書きされている場合はコンテナ設定を取得しない', async () => {
    getContainerSettingsFileMock.mockClear();
    contentByAnnotId.set(idSrc, 'ABC');
    contentByAnnotId.set(idTarget, 'ABC');

    await checkRelational(buildRequest({ type: 'equal', relaxation: NO_RELAXATION }));

    expect(getContainerSettingsFileMock).not.toHaveBeenCalled();
  });

  it('invalidateContainerRelaxationCacheは次回の検証時にコンテナ設定を再取得させる', async () => {
    containerRelaxation = NO_RELAXATION;
    contentByAnnotId.set(idSrc, 'ABC');
    contentByAnnotId.set(idTarget, 'ABC');
    getContainerSettingsFileMock.mockClear();

    await checkRelational(buildRequest({ type: 'equal' }));
    invalidateContainerRelaxationCache(containerID);
    await checkRelational(buildRequest({ type: 'equal' }));

    expect(getContainerSettingsFileMock).toHaveBeenCalledTimes(2);
  });
});
