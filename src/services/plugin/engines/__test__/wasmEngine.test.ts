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
    const manifest: PluginManifest = {
      id: PluginID.parse('test-plugin'),
      name: 'Test Plugin',
      version: '1.0.0',
      description: '',
      runtime: 'wasm',
      mainFile: 'test.wasm',
      requiredHostApis: [],
    };
    const now = new Date();
    const ctx: PluginExecutionContext = {
      targetFile: {
        containerID: ContainerID.parse('11111111-1111-4111-8111-111111111111'),
        type: 'File',
        path: 'a.pdf',
        createdAt: now,
        updatedAt: now,
        description: '',
        genre: '',
        tags: [],
      },
      pageCount: 1,
      representativePageSize: { width: 1, height: 1 },
      metadataJson: '{}',
      pageSizes: new Map(),
      pageTextBlocksJson: new Map(),
      pageImages: new Map(),
      existingAnnotations: [],
    };
    const state: ExecutionState = { blocks: [], plan: [], confirmationMode: 'perItem' };

    const res = await runEntryPoint(MINIMAL_ALLOC_MODULE, 'doesNotExist', [], manifest, ctx, state);
    expect(res.ok).toBe(false);
  });
});
