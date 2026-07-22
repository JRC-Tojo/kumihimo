import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { discoverEntryPoints, runEntryPoint } from 'src/services/plugin/engines/wasmEngine';
import type { PluginManifest } from 'src/models/plugin/manifest';
import type { PluginExecutionContext } from 'src/services/plugin/hostContext';
import type { ExecutionState } from 'src/services/plugin/hostApiBridge';
import type { PluginPlanItem } from 'src/models/plugin/plan';
import { ContainerID } from 'src/models/container';
import { PluginID } from 'src/models/plugin/manifest';
import { AnnotationID } from 'src/models/document/pdf';

const WASM_PATH = path.resolve(
  import.meta.dir,
  '../../../../../samplePlugins/wasmPageNumberStamper/page_number_stamper.wasm',
);

function loadBinary(): Uint8Array {
  return new Uint8Array(readFileSync(WASM_PATH));
}

function isAnnotationCreate(
  item: PluginPlanItem,
): item is Extract<PluginPlanItem, { kind: 'annotationCreate' }> {
  return item.kind === 'annotationCreate';
}

function isAnnotationRemove(
  item: PluginPlanItem,
): item is Extract<PluginPlanItem, { kind: 'annotationRemove' }> {
  return item.kind === 'annotationRemove';
}

const containerID = ContainerID.parse('11111111-1111-4111-8111-111111111111');

function buildManifest(): PluginManifest {
  return {
    id: PluginID.parse('wasm-page-number-stamper'),
    name: 'ページ番号スタンパー',
    version: '1.0.0',
    description: '',
    runtime: 'wasm',
    mainFile: 'page_number_stamper.wasm',
    requiredHostApis: [
      'ui.reportProgress',
      'plan.addAnnotation',
      'plan.removeAnnotation',
      'plan.setConfirmationMode',
      'doc.getAnnotationIdsByTag',
    ],
  };
}

function buildContext(overrides: Partial<PluginExecutionContext> = {}): PluginExecutionContext {
  return {
    targetFile: {
      containerID,
      type: 'File',
      path: 'sample.pdf',
      createdAt: new Date(),
      updatedAt: new Date(),
      description: '',
      genre: '',
      tags: [],
    },
    pageCount: 3,
    representativePageSize: { width: 600, height: 800 },
    metadataJson: '{}',
    pageSizes: new Map(),
    pageTextBlocksJson: new Map(),
    pageImages: new Map(),
    existingAnnotations: [],
    ...overrides,
  };
}

describe('wasmEngine (wasmPageNumberStamperサンプルによる実結合テスト)', () => {
  test('discoverEntryPointsがstampPageNumbersとその7フィールドを発見する', async () => {
    const res = await discoverEntryPoints(loadBinary());
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.value).toHaveLength(1);
    const descriptor = res.value[0]!;
    expect(descriptor.entryId).toBe('stampPageNumbers');
    expect(descriptor.fields.map((f) => f.fieldId)).toEqual([
      'startPage',
      'startNumber',
      'format',
      'position',
      'mirrorOddEven',
      'fontSize',
      'color',
    ]);
    expect(descriptor.fields.find((f) => f.fieldId === 'position')?.options).toEqual([
      'bottom-center',
      'bottom-left',
      'bottom-right',
      'top-center',
      'top-left',
      'top-right',
    ]);
  });

  test('runEntryPointが複数ページ・奇偶ミラーONの座標を期待通りに算出する', async () => {
    const manifest = buildManifest();
    const ctx = buildContext({ pageCount: 3 });
    const state: ExecutionState = { blocks: [], plan: [], confirmationMode: 'perItem' };

    // 引数順: [システムコンテキスト] pageCount, pageWidth, pageHeight →
    //         [discover宣言順] startPage, startNumber, format, position, mirrorOddEven, fontSize, color
    const positionalArgs: Array<string | number | boolean> = [
      ctx.pageCount,
      ctx.representativePageSize.width,
      ctx.representativePageSize.height,
      1,
      1,
      '{n}',
      'bottom-left',
      true,
      12,
      '#ff0000',
    ];

    const result = await runEntryPoint(
      loadBinary(),
      'stampPageNumbers',
      positionalArgs,
      manifest,
      ctx,
      state,
    );
    expect(result.ok).toBe(true);

    const created = state.plan.filter(isAnnotationCreate);
    expect(created).toHaveLength(3);
    expect(created.every((item) => item.confirmationMode === 'once')).toBe(true);

    const page1 = created.find((item) => item.style.pageNumber === 1);
    const page2 = created.find((item) => item.style.pageNumber === 2);
    const page3 = created.find((item) => item.style.pageNumber === 3);

    // ページ1（奇数、ミラー未適用）: bottom-left → x = margin(20)
    expect(page1?.style.x).toBeCloseTo(20, 1);
    if (page1?.style.type === 'text') expect(page1.style.text).toBe('1');

    // ページ2（偶数、ミラー適用でbottom-left→bottom-right）: x = pageWidth - margin - boxWidth = 600-20-80
    expect(page2?.style.x).toBeCloseTo(500, 1);
    if (page2?.style.type === 'text') expect(page2.style.text).toBe('2');

    // ページ3（奇数、ミラー未適用）: bottom-left → x = margin(20)
    expect(page3?.style.x).toBeCloseTo(20, 1);
    if (page3?.style.type === 'text') expect(page3.style.text).toBe('3');
  });

  test('再実行時、前回タグ付けされたアノテーションの削除予定が積まれる（冪等な再実行）', async () => {
    const manifest = buildManifest();
    const existingId = AnnotationID.parse('22222222-2222-4222-8222-222222222222');
    const ctx = buildContext({
      pageCount: 1,
      existingAnnotations: [
        {
          style: {
            id: existingId,
            type: 'text',
            pageNumber: 1,
            x: 0,
            y: 0,
            width: 80,
            height: 18,
            text: 'old',
            fontFamily: 'sans-serif',
            fontSize: 12,
            fontWeight: 400,
            textColor: '#000000' as never,
            textAlign: 'center',
            color: '#000000' as never,
            strokeWidth: 0,
            strokeType: 'solid',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            comment: {},
            tags: ['page-number-stamper'],
          },
          context: {},
        },
      ],
    });
    const state: ExecutionState = { blocks: [], plan: [], confirmationMode: 'perItem' };
    const positionalArgs: Array<string | number | boolean> = [
      ctx.pageCount,
      ctx.representativePageSize.width,
      ctx.representativePageSize.height,
      1,
      1,
      '{n}',
      'bottom-center',
      false,
      12,
      '#000000',
    ];

    const result = await runEntryPoint(
      loadBinary(),
      'stampPageNumbers',
      positionalArgs,
      manifest,
      ctx,
      state,
    );
    expect(result.ok).toBe(true);

    const removed = state.plan.filter(isAnnotationRemove);
    expect(removed).toHaveLength(1);
    expect(removed[0]?.annotId).toBe(existingId);
  });
});
