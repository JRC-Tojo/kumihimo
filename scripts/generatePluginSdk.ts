/**
 * `src/services/plugin/hostApiRegistry.ts`から、Rust SDK（`PLUGIN_SDK/rust/host_sdk.rs`）の
 * `extern "C"`ブロック（GENERATED-EXTERNマーカー区間）を再生成する
 *
 * 実行: `bun run generate:plugin-sdk`
 *
 * `hostApiRegistry.ts`を変更した後は必ずこれを実行すること。忘れると
 * `src/services/plugin/__test__/hostApiCodegen.test.ts`が落ちて気づける
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { generateRustExternBlock, replaceMarkedBlock } from '../src/services/plugin/hostApiCodegen';
import { HOST_API_REGISTRY } from '../src/services/plugin/hostApiRegistry';

const HOST_SDK_PATH = path.resolve(import.meta.dir, '../PLUGIN_SDK/rust/host_sdk.rs');

const current = readFileSync(HOST_SDK_PATH, 'utf-8');
const generated = generateRustExternBlock(HOST_API_REGISTRY);
const updated = replaceMarkedBlock(current, generated);

writeFileSync(HOST_SDK_PATH, updated, 'utf-8');
console.log(`Updated: ${HOST_SDK_PATH}`);
