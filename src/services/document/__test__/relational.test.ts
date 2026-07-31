import { describe, expect, it, mock } from 'bun:test';
import type { ContainerID } from 'src/models/container';
import type { AnnotationID, AnnotationStyle } from 'src/models/document/pdf';
import type { Result } from 'src/models/error/result';
import { Success } from 'src/models/error/result';
import type {
  AnnotationBaseAddress,
  AnnotationInfo,
  RelationalRule,
} from 'src/models/relational/fileSchema';
import type { RelationalWithAddress } from 'src/models/relational/common';
import type { AppSettings } from 'src/models/settings';
import {
  DEFAULT_RELAXATION_OPTIONS,
  type RelaxationOptions,
} from 'src/models/relational/relaxation';

/**
 * `src/services/document/annotation`と`src/settings/main`をモック化し、IndexedDB/OCR等を
 * 使わずに`checkRelational`の緩和・計算ロジックのみを検証する
 */
const containerID = '00000000-0000-4000-8000-000000000000' as ContainerID;
const idSrc = '00000000-0000-4000-8000-000000000001' as AnnotationID;
const idTarget = '00000000-0000-4000-8000-000000000002' as AnnotationID;

function baseStyle(id: AnnotationID): AnnotationStyle {
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
  };
}

// annotIDごとのOCR抽出値。各テストの冒頭で書き換えてから使う
const contentByAnnotId = new Map<AnnotationID, string>();

const getAnnotationInfoMock = mock((id: AnnotationID): Promise<Result<AnnotationInfo>> =>
  Promise.resolve(
    Success<AnnotationInfo>({
      style: baseStyle(id),
      context: { text: contentByAnnotId.get(id) ?? '' },
    }),
  ),
);
const getAnnotationAddressMock = mock(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
  (_id: AnnotationID): Promise<Result<AnnotationBaseAddress>> =>
    Promise.resolve(Success<AnnotationBaseAddress>({ cID: containerID, filePath: 'doc.pdf' })),
);
const registerAnnotationInfoMock = mock((): Promise<Result<void>> => Promise.resolve(Success()));

void mock.module('src/services/document/annotation', () => ({
  getAnnotationInfo: getAnnotationInfoMock,
  getAnnotationAddress: getAnnotationAddressMock,
  registerAnnotationInfo: registerAnnotationInfoMock,
}));

// アプリ設定側の緩和ルール。各テストの冒頭で書き換えてから使う
let relaxationSettings: RelaxationOptions = DEFAULT_RELAXATION_OPTIONS;
const getSettingsMock = mock((): Promise<Result<AppSettings>> =>
  Promise.resolve(Success({ relationalRelaxation: relaxationSettings } as AppSettings)),
);
void mock.module('src/settings/main', () => ({
  getSettings: getSettingsMock,
}));

const { checkRelational } = await import('../relational');

const dummyAddress: AnnotationBaseAddress = { cID: containerID, filePath: 'doc.pdf' };

function buildRequest(rule: RelationalRule): RelationalWithAddress {
  return {
    relational: { srcID: idSrc, targetID: idTarget, rule },
    srcAddress: dummyAddress,
    targetAddress: dummyAddress,
  };
}

describe('checkRelational', () => {
  it('緩和ルールが無効な場合は完全一致のみOKになる', async () => {
    relaxationSettings = DEFAULT_RELAXATION_OPTIONS;
    contentByAnnotId.set(idSrc, 'ABC');
    contentByAnnotId.set(idTarget, 'abc');

    const res = await checkRelational(buildRequest({ type: 'equal' }));
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.checkedRule?.isOK).toBe(false);
  });

  it('アプリ設定側の緩和ルール（ignoreCase）が既定値として反映される', async () => {
    relaxationSettings = { ...DEFAULT_RELAXATION_OPTIONS, ignoreCase: true };
    contentByAnnotId.set(idSrc, 'ABC');
    contentByAnnotId.set(idTarget, 'abc');

    const res = await checkRelational(buildRequest({ type: 'equal' }));
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.checkedRule?.isOK).toBe(true);
  });

  it('アノテーション別のrelaxationはアプリ設定を完全に上書きする（マージしない）', async () => {
    // グローバル設定はignoreCase:trueだが、アノテーション別の上書きにはignoreCaseを含めない
    relaxationSettings = { ...DEFAULT_RELAXATION_OPTIONS, ignoreCase: true };
    contentByAnnotId.set(idSrc, 'ABC');
    contentByAnnotId.set(idTarget, 'abc');

    const res = await checkRelational(
      buildRequest({
        type: 'equal',
        relaxation: { ...DEFAULT_RELAXATION_OPTIONS, ignoreWhitespace: true },
      }),
    );
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    // ignoreCaseはグローバル設定にのみ存在し、上書き設定には引き継がれないためNGになる
    expect(res.value.checkedRule?.isOK).toBe(false);
  });

  it('srcFormulaを自身の値に適用してから比較する（表示用の値は生値のまま）', async () => {
    relaxationSettings = DEFAULT_RELAXATION_OPTIONS;
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
    relaxationSettings = DEFAULT_RELAXATION_OPTIONS;
    contentByAnnotId.set(idSrc, 'N/A');
    contentByAnnotId.set(idTarget, 'N/A');

    const res = await checkRelational(buildRequest({ type: 'equal', srcFormula: 'x + 9' }));
    expect(res.ok).toBeTrue();
    if (!res.ok) return;
    expect(res.value.checkedRule?.isOK).toBe(true);
  });

  it('constValは比較に一切影響しない（未使用フィールド）', async () => {
    relaxationSettings = DEFAULT_RELAXATION_OPTIONS;
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
});
