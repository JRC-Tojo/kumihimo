import { describe, expect, it, mock } from 'bun:test';
import { Success, Failure } from 'src/models/error/result';
import { ContainerID } from 'src/models/container';
import { AnnotationID } from 'src/models/document/pdf';
import type { PluginID, PluginManifest } from 'src/models/plugin/manifest';
import type { InstalledPlugin } from 'src/models/plugin/installation';
import type { PluginRunState } from 'src/models/plugin/panel';
import type { PluginPlanItem } from 'src/models/plugin/plan';

const containerID = ContainerID.parse('11111111-1111-4111-8111-111111111111');
const targetFile = {
  containerID,
  type: 'File' as const,
  path: 'a.pdf',
  createdAt: new Date(),
  updatedAt: new Date(),
  description: '',
  genre: '',
  tags: [],
};

// runtimeは'pyodide'を使う（wasmEngineは`engines/__test__/wasmEngine.test.ts`が実バイナリで
// 検証しており、bun testはmock.moduleがプロセス全体で共有されるため、こちらではwasmEngineを
// 一切モックしない。switchEngineProcessの分岐ロジック自体はランタイムに依らず対称なので、
// pyodide側の分岐だけをモックしてもrun.tsの実行フロー・plan/commitロジックの検証には十分）
const manifest: PluginManifest = {
  id: 'test-plugin' as PluginID,
  name: 'テストプラグイン',
  version: '1.0.0',
  description: '',
  runtime: 'pyodide',
  mainFile: 'test.py',
  requiredHostApis: ['ui.reportProgress', 'plan.addAnnotation'],
};
const installed: InstalledPlugin = { manifest, installedAt: new Date(), enabled: true };

// ---- リポジトリ層のモック ----
const runStates = new Map<string, PluginRunState>();
const getInstalledPluginMock = mock(() => Promise.resolve(Success(installed)));
const putRunStateMock = mock((state: PluginRunState) => {
  runStates.set(state.runId, state);
  return Promise.resolve(Success(undefined));
});
const getRunStateMock = mock((runId: string) => {
  const found = runStates.get(runId);
  return Promise.resolve(found ? Success(found) : Failure(new Error('not found')));
});
void mock.module('src/repositories/db/plugin', () => ({
  getInstalledPlugin: getInstalledPluginMock,
  putRunState: putRunStateMock,
  getRunState: getRunStateMock,
  observeRunState: () => {
    throw new Error('not used in this test');
  },
}));

const getPluginBinaryMock = mock(() => Promise.resolve(Success(new Uint8Array([1, 2, 3]))));
void mock.module('src/services/plugin/install', () => ({
  getPluginBinary: getPluginBinaryMock,
}));

void mock.module('src/services/plugin/hostContext', () => ({
  buildExecutionContext: () =>
    Promise.resolve(
      Success({
        targetFiles: [targetFile],
        pageCount: 2,
        representativePageSize: { width: 600, height: 800 },
        metadataJson: '{}',
        pageSizes: new Map(),
        pageTextBlocksJson: new Map(),
        pageImages: new Map(),
        existingAnnotations: [],
      }),
    ),
}));

// 注意: `bun test`のmock.moduleはプロセス全体で共有される（テストファイルをまたいで永続する）ため、
// `src/services/plugin/engines/wasmEngine.test.ts`が実バイナリで検証する対象である
// wasmEngineモジュールはここでは一切モックしない（pyodideEngine側のみモックする。上記コメント参照）
const discoverEntryPointsMock = mock(() =>
  Promise.resolve(
    Success([
      {
        entryId: 'doSomething',
        label: 'ラベル',
        description: '',
        fields: [
          { fieldId: 'count', label: '件数', type: 'number', defaultValue: 1, optional: true },
        ],
      },
    ]),
  ),
);
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- mock.calls[N]の型付けのためだけに引数を宣言する
const pyodideRunEntryPointMock = mock((...args: unknown[]) => Promise.resolve(Success(1)));
void mock.module('src/services/plugin/engines/pyodideEngine', () => ({
  discoverEntryPoints: discoverEntryPointsMock,
  runEntryPoint: pyodideRunEntryPointMock,
}));

const registerAnnotationStyleMock = mock(() => Promise.resolve(Success({} as never)));
const removeAnnotationInfoMock = mock(() => Promise.resolve(Success(undefined)));
const getAnnotationAddressMock = mock(() =>
  Promise.resolve(Success({ cID: containerID, filePath: 'a.pdf' })),
);
void mock.module('src/services/document/annotation', () => ({
  registerAnnotationStyle: registerAnnotationStyleMock,
  removeAnnotationInfo: removeAnnotationInfoMock,
  getAnnotationAddress: getAnnotationAddressMock,
  getAnnotationsByFile: () => Promise.resolve(Failure(new Error('not used in this test'))),
}));

const registRelationalMock = mock(() => Promise.resolve(Success({} as never)));
const removeRelationalEdgeMock = mock(() => Promise.resolve(Success(undefined)));
const removeRelationalsForAnnotationMock = mock(() => Promise.resolve(Success(undefined)));
void mock.module('src/services/document/relational', () => ({
  registRelational: registRelationalMock,
  removeRelationalEdge: removeRelationalEdgeMock,
  removeRelationalsForAnnotation: removeRelationalsForAnnotationMock,
}));

const { discoverEntryPoints, runEntryPoint, approvePlanItems, rejectPlanItems } =
  await import('../run');

const pluginId = 'test-plugin' as PluginID;

describe('discoverEntryPoints', () => {
  it('runtimeに応じてpyodideEngineへ振り分ける', async () => {
    const res = await discoverEntryPoints(pluginId);
    expect(res.ok).toBeTrue();
    expect(discoverEntryPointsMock).toHaveBeenCalled();
  });
});

describe('runEntryPoint', () => {
  it('システムコンテキスト＋discover宣言順のユーザー入力値をpositionalArgsとして渡す', async () => {
    pyodideRunEntryPointMock.mockClear();

    const res = await runEntryPoint(pluginId, 'doSomething', { count: 5 }, [targetFile]);
    expect(res.ok).toBeTrue();
    if (!res.ok) return;

    expect(res.value.status).toBe('done');
    expect(pyodideRunEntryPointMock).toHaveBeenCalledTimes(1);
    const call = pyodideRunEntryPointMock.mock.calls[0]!;
    // call: [binary, entryId, positionalArgs, manifest, ctx, state]
    expect(call[1]).toBe('doSomething');
    expect(call[2]).toEqual([2, 600, 800, 5]); // pageCount, pageWidth, pageHeight, count
  });

  it('fieldValuesに未指定のフィールドはdefaultValueで補われる', async () => {
    pyodideRunEntryPointMock.mockClear();

    await runEntryPoint(pluginId, 'doSomething', {}, [targetFile]);

    const call = pyodideRunEntryPointMock.mock.calls[0]!;
    expect(call[2]).toEqual([2, 600, 800, 1]); // count省略時はdefaultValue(1)
  });
});

describe('approvePlanItems / rejectPlanItems', () => {
  function makeRunState(plan: PluginPlanItem[]): PluginRunState {
    const runId = `run-${Math.random()}`;
    const state: PluginRunState = {
      runId,
      pluginId,
      entryId: 'doSomething',
      targetFiles: [targetFile],
      blocks: [],
      plan,
      status: 'done',
    };
    runStates.set(runId, state);
    return state;
  }

  it('annotationCreate/annotationUpdateはregisterAnnotationStyleへ振り分けられ、committedになる', async () => {
    registerAnnotationStyleMock.mockClear();
    const textStyle = {
      id: AnnotationID.parse('22222222-2222-4222-8222-222222222222'),
      type: 'text' as const,
      pageNumber: 1,
      x: 0,
      y: 0,
      color: '#000000' as never,
      strokeWidth: 2,
      strokeType: 'solid' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      comment: {},
      width: 10,
      height: 10,
      text: '1',
      fontFamily: 'sans-serif',
      fontSize: 12,
      fontWeight: 400,
      textColor: '#000000' as never,
      textAlign: 'center' as const,
    };
    const runState = makeRunState([
      {
        id: 'p1',
        kind: 'annotationCreate',
        confirmationMode: 'once',
        status: 'planned',
        file: { containerID, path: 'a.pdf' },
        style: textStyle,
      },
    ]);

    const res = await approvePlanItems(runState.runId, ['p1']);
    expect(res.ok).toBeTrue();
    expect(registerAnnotationStyleMock).toHaveBeenCalledTimes(1);
    expect(runStates.get(runState.runId)?.plan[0]?.status).toBe('committed');
  });

  it('annotationRemoveはremoveAnnotationInfo+removeRelationalsForAnnotationへ振り分けられる', async () => {
    removeAnnotationInfoMock.mockClear();
    removeRelationalsForAnnotationMock.mockClear();
    const annotId = AnnotationID.parse('33333333-3333-4333-8333-333333333333');
    const runState = makeRunState([
      {
        id: 'p2',
        kind: 'annotationRemove',
        confirmationMode: 'once',
        status: 'planned',
        file: { containerID, path: 'a.pdf' },
        annotId,
      },
    ]);

    await approvePlanItems(runState.runId, ['p2']);

    expect(removeAnnotationInfoMock).toHaveBeenCalledTimes(1);
    expect(removeRelationalsForAnnotationMock).toHaveBeenCalledTimes(1);
    expect(runStates.get(runState.runId)?.plan[0]?.status).toBe('committed');
  });

  it('relationalCreate/relationalRemoveはそれぞれregistRelational/removeRelationalEdgeへ振り分けられる', async () => {
    registRelationalMock.mockClear();
    removeRelationalEdgeMock.mockClear();
    const srcId = AnnotationID.parse('44444444-4444-4444-8444-444444444444');
    const targetId = AnnotationID.parse('55555555-5555-4555-8555-555555555555');
    const runState = makeRunState([
      {
        id: 'p3',
        kind: 'relationalCreate',
        confirmationMode: 'once',
        status: 'planned',
        relational: { srcID: srcId, targetID: targetId, rule: { type: 'link' } },
      },
      {
        id: 'p4',
        kind: 'relationalRemove',
        confirmationMode: 'once',
        status: 'planned',
        srcId,
        targetId,
      },
    ]);

    await approvePlanItems(runState.runId, ['p3', 'p4']);

    expect(registRelationalMock).toHaveBeenCalledTimes(1);
    expect(removeRelationalEdgeMock).toHaveBeenCalledTimes(1);
  });

  it('対象ファイル外のannotIdを指定したannotationUpdateは安全確認で却下される', async () => {
    getAnnotationAddressMock.mockImplementationOnce(() =>
      Promise.resolve(Success({ cID: containerID, filePath: 'other.pdf' })),
    );
    registerAnnotationStyleMock.mockClear();

    const annotId = AnnotationID.parse('66666666-6666-4666-8666-666666666666');
    const runState = makeRunState([
      {
        id: 'p5',
        kind: 'annotationUpdate',
        confirmationMode: 'once',
        status: 'planned',
        file: { containerID, path: 'a.pdf' },
        annotId,
        style: {
          id: annotId,
          type: 'text' as const,
          pageNumber: 1,
          x: 0,
          y: 0,
          color: '#000000' as never,
          strokeWidth: 2,
          strokeType: 'solid' as const,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          comment: {},
          width: 10,
          height: 10,
          text: '1',
          fontFamily: 'sans-serif',
          fontSize: 12,
          fontWeight: 400,
          textColor: '#000000' as never,
          textAlign: 'center' as const,
        },
      },
    ]);

    await approvePlanItems(runState.runId, ['p5']);

    expect(registerAnnotationStyleMock).not.toHaveBeenCalled();
    expect(runStates.get(runState.runId)?.plan[0]?.status).toBe('rejected');
  });

  it('rejectPlanItemsは実データへの反映なしにstatusをrejectedにする', async () => {
    registerAnnotationStyleMock.mockClear();
    const runState = makeRunState([
      {
        id: 'p6',
        kind: 'annotationCreate',
        confirmationMode: 'perItem',
        status: 'planned',
        file: { containerID, path: 'a.pdf' },
        style: {
          id: AnnotationID.parse('77777777-7777-4777-8777-777777777777'),
          type: 'text' as const,
          pageNumber: 1,
          x: 0,
          y: 0,
          color: '#000000' as never,
          strokeWidth: 2,
          strokeType: 'solid' as const,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          comment: {},
          width: 10,
          height: 10,
          text: '1',
          fontFamily: 'sans-serif',
          fontSize: 12,
          fontWeight: 400,
          textColor: '#000000' as never,
          textAlign: 'center' as const,
        },
      },
    ]);

    await rejectPlanItems(runState.runId, ['p6']);

    expect(registerAnnotationStyleMock).not.toHaveBeenCalled();
    expect(runStates.get(runState.runId)?.plan[0]?.status).toBe('rejected');
  });
});
