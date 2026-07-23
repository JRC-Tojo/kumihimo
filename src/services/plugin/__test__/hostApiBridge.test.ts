import { describe, expect, it } from 'bun:test';
import { ContainerID } from 'src/models/container';
import { AnnotationID } from 'src/models/document/pdf';
import type { PluginManifest } from 'src/models/plugin/manifest';
import type { PluginExecutionContext, PluginFileContext } from '../hostContext';
import {
  buildDiscoveryBridge,
  buildExecutionBridge,
  type DiscoveryState,
  type ExecutionState,
} from '../hostApiBridge';

const containerID = ContainerID.parse('11111111-1111-4111-8111-111111111111');
const existingAnnotId = AnnotationID.parse('22222222-2222-4222-8222-222222222222');
const secondFileAnnotId = AnnotationID.parse('33333333-3333-4333-8333-333333333333');

function buildManifest(requiredHostApis: PluginManifest['requiredHostApis']): PluginManifest {
  return {
    id: 'test-plugin' as never,
    name: 'テストプラグイン',
    version: '1.0.0',
    description: '',
    runtime: 'wasm',
    mainFile: 'test.wasm',
    requiredHostApis,
  };
}

function buildFileContext(
  overrides: Partial<PluginFileContext> = {},
): PluginFileContext {
  return {
    pageCount: 1,
    metadataJson: '{}',
    pageSizes: new Map(),
    pageTextBlocksJson: new Map(),
    pageImages: new Map(),
    existingAnnotations: [],
    ...overrides,
  };
}

function buildContext(overrides: Partial<PluginExecutionContext> = {}): PluginExecutionContext {
  return {
    targetFiles: [
      {
        containerID,
        type: 'File',
        path: 'a.pdf',
        createdAt: new Date(),
        updatedAt: new Date(),
        description: '',
        genre: '',
        tags: [],
      },
    ],
    fileContexts: [buildFileContext()],
    representativePageSize: { width: 600, height: 800 },
    ...overrides,
  };
}

describe('buildDiscoveryBridge', () => {
  it('ui_register_entry_pointとui_add_*_fieldの呼び出しをDiscoveryStateへ蓄積する', () => {
    const state: DiscoveryState = { entryPoints: [] };
    const bridge = buildDiscoveryBridge(state);

    bridge.ui_register_entry_point!('doSomething', 'ラベル', '説明');
    bridge.ui_add_number_field!('n', '数値', 1, true);
    bridge.ui_add_select_field!('pos', '位置', 'a,b,c', 'a');

    expect(state.entryPoints).toHaveLength(1);
    expect(state.entryPoints[0]?.entryId).toBe('doSomething');
    expect(state.entryPoints[0]?.fields).toEqual([
      { fieldId: 'n', label: '数値', type: 'number', defaultValue: 1, optional: true },
      {
        fieldId: 'pos',
        label: '位置',
        type: 'select',
        defaultValue: 'a',
        options: ['a', 'b', 'c'],
        optional: true,
      },
    ]);
  });

  it('registerEntryPointより前にaddXFieldが呼ばれた場合は無視する（対象エントリポイントがないため）', () => {
    const state: DiscoveryState = { entryPoints: [] };
    const bridge = buildDiscoveryBridge(state);

    bridge.ui_add_number_field!('n', 'ラベル', 1, true);

    expect(state.entryPoints).toHaveLength(0);
  });
});

describe('buildExecutionBridge（最小権限）', () => {
  it('requiredHostApisに列挙したAPIのみが注入される', () => {
    const manifest = buildManifest(['ui.reportProgress']);
    const ctx = buildContext();
    const state: ExecutionState = { blocks: [], plan: [], confirmationMode: 'perItem' };

    const bridge = buildExecutionBridge(manifest, ctx, state);

    expect(Object.keys(bridge)).toEqual(['ui_report_progress']);
  });

  it('plan.addAnnotationはfileIndexで指定したファイルに対してstate.planへ積むだけで、authorに常にプラグイン名を強制する', () => {
    const manifest = buildManifest(['plan.addAnnotation']);
    const ctx = buildContext();
    const state: ExecutionState = { blocks: [], plan: [], confirmationMode: 'once' };
    const bridge = buildExecutionBridge(manifest, ctx, state);

    const planItemId = bridge.plan_add_annotation!(
      0,
      1,
      10,
      20,
      80,
      18,
      'こんにちは',
      '#ff0000',
      12,
      'tag1,tag2',
    );

    expect(typeof planItemId).toBe('string');
    expect(state.plan).toHaveLength(1);
    const item = state.plan[0]!;
    expect(item.kind).toBe('annotationCreate');
    expect(item.confirmationMode).toBe('once');
    if (item.kind === 'annotationCreate') {
      expect(item.style.author).toBe('テストプラグイン');
      expect(item.style.tags).toEqual(['tag1', 'tag2']);
      if (item.style.type === 'text') expect(item.style.text).toBe('こんにちは');
    }
  });

  it('plan.addAnnotationに存在しないfileIndexを渡した場合は何も積まず空文字を返す', () => {
    const manifest = buildManifest(['plan.addAnnotation']);
    const ctx = buildContext();
    const state: ExecutionState = { blocks: [], plan: [], confirmationMode: 'once' };
    const bridge = buildExecutionBridge(manifest, ctx, state);

    const result = bridge.plan_add_annotation!(5, 1, 10, 20, 80, 18, 'x', '#ff0000', 12, '');

    expect(result).toBe('');
    expect(state.plan).toHaveLength(0);
  });

  it('doc.getAnnotationIdsByTagは指定fileIndex・タグを持つ既存アノテーションのIDのみをCSVで返す', () => {
    const manifest = buildManifest(['doc.getAnnotationIdsByTag']);
    const ctx = buildContext({
      fileContexts: [
        buildFileContext({
          existingAnnotations: [
            {
              style: {
                id: existingAnnotId,
                type: 'box',
                pageNumber: 1,
                x: 0,
                y: 0,
                color: '#000000' as never,
                strokeWidth: 2,
                strokeType: 'solid',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
                comment: {},
                width: 10,
                height: 10,
                tags: ['page-number-stamper'],
              },
              context: {},
            },
          ],
        }),
      ],
    });
    const state: ExecutionState = { blocks: [], plan: [], confirmationMode: 'perItem' };
    const bridge = buildExecutionBridge(manifest, ctx, state);

    expect(bridge.doc_get_annotation_ids_by_tag!(0, 'page-number-stamper')).toBe(existingAnnotId);
    expect(bridge.doc_get_annotation_ids_by_tag!(0, 'other-tag')).toBe('');
  });

  it('plan.removeAnnotationに不正なID（uuid以外）を渡した場合は何も積まず空文字を返す', () => {
    const manifest = buildManifest(['plan.removeAnnotation']);
    const ctx = buildContext();
    const state: ExecutionState = { blocks: [], plan: [], confirmationMode: 'perItem' };
    const bridge = buildExecutionBridge(manifest, ctx, state);

    const result = bridge.plan_remove_annotation!('not-a-valid-uuid');

    expect(result).toBe('');
    expect(state.plan).toHaveLength(0);
  });

  it('plan.updateAnnotationは対象IDがtargetFiles[1]（2件目以降）に属する場合でも、fileIndex指定なしで正しいファイルへ自動解決する', () => {
    const secondContainerID = ContainerID.parse('44444444-4444-4444-8444-444444444444');
    const manifest = buildManifest(['plan.updateAnnotation']);
    const ctx = buildContext({
      targetFiles: [
        {
          containerID,
          type: 'File',
          path: 'a.pdf',
          createdAt: new Date(),
          updatedAt: new Date(),
          description: '',
          genre: '',
          tags: [],
        },
        {
          containerID: secondContainerID,
          type: 'File',
          path: 'b.pdf',
          createdAt: new Date(),
          updatedAt: new Date(),
          description: '',
          genre: '',
          tags: [],
        },
      ],
      fileContexts: [
        buildFileContext(),
        buildFileContext({
          existingAnnotations: [
            {
              style: {
                id: secondFileAnnotId,
                type: 'text',
                pageNumber: 1,
                x: 0,
                y: 0,
                width: 10,
                height: 10,
                text: '旧テキスト',
                fontFamily: 'sans-serif',
                fontSize: 12,
                fontWeight: 400,
                textColor: '#000000' as never,
                textAlign: 'center',
                color: '#000000' as never,
                strokeWidth: 0,
                strokeType: 'solid',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
                comment: {},
              },
              context: {},
            },
          ],
        }),
      ],
    });
    const state: ExecutionState = { blocks: [], plan: [], confirmationMode: 'perItem' };
    const bridge = buildExecutionBridge(manifest, ctx, state);

    const planItemId = bridge.plan_update_annotation!(
      secondFileAnnotId,
      1,
      2,
      30,
      40,
      '新テキスト',
      '#00ff00',
      14,
      '',
    );

    expect(typeof planItemId).toBe('string');
    expect(planItemId).not.toBe('');
    expect(state.plan).toHaveLength(1);
    const item = state.plan[0]!;
    expect(item.kind).toBe('annotationUpdate');
    if (item.kind === 'annotationUpdate') {
      // targetFiles[0]ではなく、実際にIDが属するtargetFiles[1]へ自動解決されていること
      expect(item.file.containerID).toBe(secondContainerID);
      expect(item.file.path).toBe('b.pdf');
      if (item.style.type === 'text') expect(item.style.text).toBe('新テキスト');
    }
  });

  it('ui.reportProgressは同一ラン内でprogressブロックを1つに集約する（追加せず更新する）', () => {
    const manifest = buildManifest(['ui.reportProgress']);
    const ctx = buildContext();
    const state: ExecutionState = { blocks: [], plan: [], confirmationMode: 'perItem' };
    const bridge = buildExecutionBridge(manifest, ctx, state);

    bridge.ui_report_progress!(20);
    bridge.ui_report_progress!(80);

    expect(state.blocks).toHaveLength(1);
    expect(state.blocks[0]).toEqual({ kind: 'progress', label: '', percent: 80 });
  });

  it('ui.logは同一ラン内で1つのlogブロックに行を蓄積する', () => {
    const manifest = buildManifest(['ui.log']);
    const ctx = buildContext();
    const state: ExecutionState = { blocks: [], plan: [], confirmationMode: 'perItem' };
    const bridge = buildExecutionBridge(manifest, ctx, state);

    bridge.ui_log!('1行目');
    bridge.ui_log!('2行目');

    expect(state.blocks).toHaveLength(1);
    expect(state.blocks[0]).toEqual({ kind: 'log', lines: ['1行目', '2行目'] });
  });

  it('ui.reportErrorはseverity:errorのtextブロックを積み、state.hasPluginReportedErrorを立てる', () => {
    const manifest = buildManifest(['ui.reportError']);
    const ctx = buildContext();
    const state: ExecutionState = { blocks: [], plan: [], confirmationMode: 'perItem' };
    const bridge = buildExecutionBridge(manifest, ctx, state);

    bridge.ui_report_error!('入力が不正です');

    expect(state.blocks).toEqual([
      { kind: 'text', text: '入力が不正です', severity: 'error' },
    ]);
    expect(state.hasPluginReportedError).toBe(true);
  });
});
