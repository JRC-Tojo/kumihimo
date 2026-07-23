/**
 * `hostApiRegistry.ts`（ホストAPIシグネチャの唯一の情報源）と、コミット済みの
 * `PLUGIN_SDK/rust/host_sdk.rs`のGENERATED-EXTERNマーカー区間が一致していることを検証する
 *
 * どちらか片方だけを手で変更してしまった場合、このテストが赤くなって気づける。
 * 失敗した場合は `bun run generate:plugin-sdk` を実行してから再度テストすること
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { extractMarkedBlock, generateRustExternBlock } from 'src/services/plugin/hostApiCodegen';
import { HOST_API_REGISTRY } from 'src/services/plugin/hostApiRegistry';

const HOST_SDK_PATH = path.resolve(import.meta.dir, '../../../../PLUGIN_SDK/rust/host_sdk.rs');

describe('hostApiCodegen', () => {
  test('PLUGIN_SDK/rust/host_sdk.rsのGENERATED-EXTERN区間はHOST_API_REGISTRYと一致している', () => {
    const fileText = readFileSync(HOST_SDK_PATH, 'utf-8');
    const actual = extractMarkedBlock(fileText);
    expect(actual).toBeDefined();

    const expected = generateRustExternBlock(HOST_API_REGISTRY);
    expect(actual).toBe(expected);
  });

  test('レジストリのシグネチャがずれた場合、生成結果は一致しなくなる（ズレ検知が機能することの確認）', () => {
    const fileText = readFileSync(HOST_SDK_PATH, 'utf-8');
    const actual = extractMarkedBlock(fileText);

    const tampered = HOST_API_REGISTRY.map((spec) =>
      spec.hostFnName === 'doc_get_page_size'
        ? { ...spec, params: [spec.params[0]!] } // file_index引数を1つ削ってみる
        : spec,
    );
    const tamperedGenerated = generateRustExternBlock(tampered);

    expect(tamperedGenerated).not.toBe(actual);
  });
});
