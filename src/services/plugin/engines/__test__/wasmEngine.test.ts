/**
 * wasmEngine.tsのNUL終端UTF-8ポインタ規約が、実際のWASMランタイム上で正しく往復できることを
 * 確認する回帰テスト
 *
 * ここで使う`MINIMAL_ALLOC_MODULE`は、以下と等価な最小限のWAT（WebAssembly Text）モジュールを
 * 手書きでバイナリエンコードしたもの（開発環境にAssemblyScript/Rust等のツールチェインが
 * 無くてもテストできるようにするため）:
 *
 * (module
 *   (memory (export "memory") 2)
 *   (global $heap_ptr (mut i32) (i32.const 1024))
 *   (func (export "alloc") (param $size i32) (result i32)
 *     (local $ptr i32)
 *     (local.set $ptr (global.get $heap_ptr))
 *     (global.set $heap_ptr (i32.add (global.get $heap_ptr) (local.get $size)))
 *     (local.get $ptr)))
 */
import { describe, expect, test } from 'bun:test';
import { discoverEntryPoints, runEntryPoint } from 'src/services/plugin/engines/wasmEngine';
import type { ExecutionState } from 'src/services/plugin/hostApiBridge';
import type { PluginExecutionContext } from 'src/services/plugin/hostContext';
import { PluginID, type PluginManifest } from 'src/models/plugin/manifest';
import { ContainerID } from 'src/models/container';

// prettier-ignore
const MINIMAL_ALLOC_MODULE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic + version
  // Type section: (i32) -> i32
  0x01, 0x06, 0x01, 0x60, 0x01, 0x7f, 0x01, 0x7f,
  // Function section: func0 uses type0
  0x03, 0x02, 0x01, 0x00,
  // Memory section: 1 memory, min 2 pages
  0x05, 0x03, 0x01, 0x00, 0x02,
  // Global section: mutable i32 heap_ptr = 1024
  0x06, 0x07, 0x01, 0x7f, 0x01, 0x41, 0x80, 0x08, 0x0b,
  // Export section: "memory" (mem 0), "alloc" (func 0)
  0x07, 0x12, 0x02,
  0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00,
  0x05, 0x61, 0x6c, 0x6c, 0x6f, 0x63, 0x00, 0x00,
  // Code section: alloc body
  0x0a, 0x13, 0x01, 0x11, 0x01, 0x01, 0x7f,
  0x23, 0x00, // global.get 0
  0x21, 0x01, // local.set 1
  0x23, 0x00, // global.get 0
  0x20, 0x00, // local.get 0
  0x6a,       // i32.add
  0x24, 0x00, // global.set 0
  0x20, 0x01, // local.get 1
  0x0b,       // end
]);

/**
 * `MINIMAL_ALLOC_MODULE`に加えて、`describePlugin`（何もしない空関数）と
 * `runTest(x: i32) -> i32`（引数をそのまま返すだけの関数）をexportする最小WATモジュールを
 * 手書きでバイナリエンコードしたもの。正常系（discovery/実行の両方）を実際のWASMランタイム上で
 * 検証するために追加した。`host_system`からのインポートは一切宣言していない
 * （importObjectを満たす必要が無く、テストとして最も単純なため）。以下と等価:
 *
 * (module
 *   (memory (export "memory") 2)
 *   (global $heap_ptr (mut i32) (i32.const 1024))
 *   (func (export "alloc") (param $size i32) (result i32)
 *     (local $ptr i32)
 *     (local.set $ptr (global.get $heap_ptr))
 *     (global.set $heap_ptr (i32.add (global.get $heap_ptr) (local.get $size)))
 *     (local.get $ptr))
 *   (func (export "runTest") (param $x i32) (result i32)
 *     (local.get $x))
 *   (func (export "describePlugin")))
 */
// prettier-ignore
const DESCRIBE_AND_ENTRY_MODULE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic + version
  // Type section: type0 (i32) -> i32 [alloc/runTestで共用], type1 () -> ()  [describePlugin]
  0x01, 0x09, 0x02, 0x60, 0x01, 0x7f, 0x01, 0x7f, 0x60, 0x00, 0x00,
  // Function section: func0(alloc)->type0, func1(runTest)->type0, func2(describePlugin)->type1
  0x03, 0x04, 0x03, 0x00, 0x00, 0x01,
  // Memory section: 1 memory, min 2 pages
  0x05, 0x03, 0x01, 0x00, 0x02,
  // Global section: mutable i32 heap_ptr = 1024
  0x06, 0x07, 0x01, 0x7f, 0x01, 0x41, 0x80, 0x08, 0x0b,
  // Export section: "memory"(mem 0), "alloc"(func 0), "runTest"(func 1), "describePlugin"(func 2)
  0x07, 0x2d, 0x04,
  0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00,
  0x05, 0x61, 0x6c, 0x6c, 0x6f, 0x63, 0x00, 0x00,
  0x07, 0x72, 0x75, 0x6e, 0x54, 0x65, 0x73, 0x74, 0x00, 0x01,
  0x0e, 0x64, 0x65, 0x73, 0x63, 0x72, 0x69, 0x62, 0x65, 0x50, 0x6c, 0x75, 0x67, 0x69, 0x6e, 0x00, 0x02,
  // Code section: alloc(既存alloc本体と同じ), runTest(引数をそのまま返す), describePlugin(何もしない)
  0x0a, 0x1b, 0x03,
  0x11, 0x01, 0x01, 0x7f,
  0x23, 0x00, // global.get 0
  0x21, 0x01, // local.set 1
  0x23, 0x00, // global.get 0
  0x20, 0x00, // local.get 0
  0x6a,       // i32.add
  0x24, 0x00, // global.set 0
  0x20, 0x01, // local.get 1
  0x0b,       // end (alloc)
  0x04, 0x00,
  0x20, 0x00, // local.get 0
  0x0b,       // end (runTest)
  0x02, 0x00,
  0x0b,       // end (describePlugin, 何もしない)
]);

/**
 * `describePlugin`が`host_system.ui_register_entry_point`を実際に呼び出す最小WATモジュール。
 * `wrapHostFn`/`readCString`のマーシャリング経路（引数のポインタを実際に読み取り、
 * ホスト側のブリッジ関数を呼び出す）を実機で通すために追加した。以下と等価（import宣言込み）:
 *
 * (module
 *   (import "host_system" "ui_register_entry_point" (func $reg (param i32 i32 i32)))
 *   (memory (export "memory") 2)
 *   (global $heap_ptr (mut i32) (i32.const 1024))
 *   (func (export "alloc") (param $size i32) (result i32) ...)
 *   (func (export "describePlugin")
 *     ;; 3引数とも同じポインタ(8番地。ゼロ初期化されたメモリ＝空文字列として読める)を渡す
 *     (call $reg (i32.const 8) (i32.const 8) (i32.const 8))))
 */
// prettier-ignore
const HOST_CALL_MODULE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic + version
  // Type section: type0 (i32)->i32 [alloc], type1 ()->() [describePlugin], type2 (i32,i32,i32)->() [import]
  0x01, 0x0f, 0x03,
  0x60, 0x01, 0x7f, 0x01, 0x7f,
  0x60, 0x00, 0x00,
  0x60, 0x03, 0x7f, 0x7f, 0x7f, 0x00,
  // Import section: host_system.ui_register_entry_point : type2
  0x02, 0x27, 0x01,
  0x0b, 0x68, 0x6f, 0x73, 0x74, 0x5f, 0x73, 0x79, 0x73, 0x74, 0x65, 0x6d, // "host_system"
  0x17, 0x75, 0x69, 0x5f, 0x72, 0x65, 0x67, 0x69, 0x73, 0x74, 0x65, 0x72, 0x5f, 0x65, 0x6e, 0x74, 0x72, 0x79, 0x5f, 0x70, 0x6f, 0x69, 0x6e, 0x74, // "ui_register_entry_point"
  0x00, 0x02,
  // Function section: func1(alloc)->type0, func2(describePlugin)->type1 (func0はimport)
  0x03, 0x03, 0x02, 0x00, 0x01,
  // Memory section: 1 memory, min 2 pages
  0x05, 0x03, 0x01, 0x00, 0x02,
  // Global section: mutable i32 heap_ptr = 1024
  0x06, 0x07, 0x01, 0x7f, 0x01, 0x41, 0x80, 0x08, 0x0b,
  // Export section: memory, alloc(func idx1), describePlugin(func idx2)
  0x07, 0x23, 0x03,
  0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00,
  0x05, 0x61, 0x6c, 0x6c, 0x6f, 0x63, 0x00, 0x01,
  0x0e, 0x64, 0x65, 0x73, 0x63, 0x72, 0x69, 0x62, 0x65, 0x50, 0x6c, 0x75, 0x67, 0x69, 0x6e, 0x00, 0x02,
  // Code section: alloc, describePlugin(importをptr=8で3引数呼び出し)
  0x0a, 0x1e, 0x02,
  0x11, 0x01, 0x01, 0x7f,
  0x23, 0x00, 0x21, 0x01, 0x23, 0x00, 0x20, 0x00, 0x6a, 0x24, 0x00, 0x20, 0x01, 0x0b,
  0x0a, 0x00,
  0x41, 0x08, 0x41, 0x08, 0x41, 0x08, 0x10, 0x00, 0x0b,
]);

// 不正なWASMバイナリ（マジックナンバー等が無く、WebAssembly.instantiate自体が例外を投げる）
const INVALID_MODULE = new Uint8Array([0x00, 0x00, 0x00, 0x00]);

/** `runEntryPoint`/`discoverEntryPoints`のテストに共通して使う最小限のマニフェストを組み立てる */
function buildTestManifest(): PluginManifest {
  return {
    id: PluginID.parse('11111111-1111-4111-8111-111111111111'),
    name: 'Test Plugin',
    version: '1.0.0',
    description: '',
    runtime: 'wasm',
    mainFile: 'test.wasm',
    requiredHostApis: [],
  };
}

/** `runEntryPoint`のテストに共通して使う最小限の実行コンテキストを組み立てる */
function buildTestContext(): PluginExecutionContext {
  const now = new Date();
  return {
    targetFiles: [
      {
        containerID: ContainerID.parse('11111111-1111-4111-8111-111111111111'),
        type: 'File',
        path: 'a.pdf',
        createdAt: now,
        updatedAt: now,
        description: '',
        genre: '',
        tags: [],
      },
    ],
    fileContexts: [
      {
        pageCount: 1,
        metadataJson: '{}',
        pageSizes: new Map(),
        pageTextBlocksJson: new Map(),
        pageImages: new Map(),
        existingAnnotations: [],
        visionTaskResults: new Map(),
      },
    ],
    representativePageSize: { width: 1, height: 1 },
  };
}

/** `runEntryPoint`のテストに共通して使う最小限の実行状態を組み立てる */
function buildTestState(): ExecutionState {
  return { blocks: [], plan: [], confirmationMode: 'perItem' };
}

describe('wasmEngine', () => {
  test('the module compiles and exposes a working alloc', async () => {
    const { instance } = await WebAssembly.instantiate(MINIMAL_ALLOC_MODULE, {});
    const exports = instance.exports as unknown as {
      memory: WebAssembly.Memory;
      alloc: (size: number) => number;
    };

    const ptrA = exports.alloc(4);
    const ptrB = exports.alloc(4);
    expect(ptrB).toBeGreaterThanOrEqual(ptrA + 4);
    expect(exports.memory.buffer.byteLength).toBeGreaterThan(0);
  });

  test('discoverEntryPoints reports a missing describePlugin export as a failure', async () => {
    const res = await discoverEntryPoints(MINIMAL_ALLOC_MODULE);
    expect(res.ok).toBe(false);
  });

  test('runEntryPoint reports a missing entry point export as a failure', async () => {
    const manifest = buildTestManifest();
    const ctx = buildTestContext();
    const state = buildTestState();

    const res = await runEntryPoint(MINIMAL_ALLOC_MODULE, 'doesNotExist', [], manifest, ctx, state);
    expect(res.ok).toBe(false);
  });

  test('discoverEntryPoints succeeds with an empty entryPoints array when describePlugin registers nothing', async () => {
    const res = await discoverEntryPoints(DESCRIBE_AND_ENTRY_MODULE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual([]);
  });

  test('runEntryPoint calls the exported entry point and returns its result on success', async () => {
    const manifest = buildTestManifest();
    const ctx = buildTestContext();
    const state = buildTestState();

    const res = await runEntryPoint(
      DESCRIBE_AND_ENTRY_MODULE,
      'runTest',
      [42],
      manifest,
      ctx,
      state,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toBe(42);
  });

  test('discoverEntryPoints marshals a real host_system call (ui_register_entry_point) through the discovery bridge', async () => {
    const res = await discoverEntryPoints(HOST_CALL_MODULE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // 3引数とも同じ「ゼロ初期化された」メモリ番地を渡しているため、readCStringは空文字列を返す
    expect(res.value).toEqual([
      { entryId: '', label: '', description: '', fields: [], visionTasks: [] },
    ]);
  });

  test('discoverEntryPoints reports a WebAssembly.instantiate failure (invalid binary) as a failure', async () => {
    const res = await discoverEntryPoints(INVALID_MODULE);
    expect(res.ok).toBe(false);
  });

  test('runEntryPoint reports a WebAssembly.instantiate failure (invalid binary) as a failure', async () => {
    const manifest = buildTestManifest();
    const ctx = buildTestContext();
    const state = buildTestState();

    const res = await runEntryPoint(INVALID_MODULE, 'runTest', [42], manifest, ctx, state);
    expect(res.ok).toBe(false);
  });
});
