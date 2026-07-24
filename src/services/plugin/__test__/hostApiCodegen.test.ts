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
import {
  extractMarkedBlock,
  generateRustExternBlock,
  replaceMarkedBlock,
} from 'src/services/plugin/hostApiCodegen';
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

describe('extractMarkedBlock', () => {
  test('マーカーが無い場合はundefinedを返す', () => {
    expect(extractMarkedBlock('no markers here')).toBeUndefined();
  });

  test('BEGIN/ENDが逆順（ENDがBEGINより前）の場合はundefinedを返す', () => {
    const text = '// GENERATED-EXTERN:END\nmiddle\n// GENERATED-EXTERN:BEGIN\n';
    expect(extractMarkedBlock(text)).toBeUndefined();
  });

  test('マーカー区間の中身（マーカー行自体は含まない）を抽出する', () => {
    const text = 'before\n// GENERATED-EXTERN:BEGIN\ncontent line\n// GENERATED-EXTERN:END\nafter';
    expect(extractMarkedBlock(text)).toBe('content line');
  });
});

describe('replaceMarkedBlock', () => {
  test('マーカーが無い場合は例外を投げる', () => {
    expect(() => replaceMarkedBlock('no markers here', 'generated')).toThrow(
      'GENERATED-EXTERN マーカーが見つかりませんでした',
    );
  });

  test('BEGIN/ENDが逆順の場合は例外を投げる', () => {
    const text = '// GENERATED-EXTERN:END\nmiddle\n// GENERATED-EXTERN:BEGIN\n';
    expect(() => replaceMarkedBlock(text, 'generated')).toThrow(
      'GENERATED-EXTERN マーカーが見つかりませんでした',
    );
  });

  test('マーカー区間を生成済みテキストで置き換える（マーカー行自体は保持する）', () => {
    const text = 'before\n// GENERATED-EXTERN:BEGIN\nold content\n// GENERATED-EXTERN:END\nafter';
    const replaced = replaceMarkedBlock(text, 'new content');
    expect(replaced).toBe(
      'before\n// GENERATED-EXTERN:BEGIN\nnew content\n    // GENERATED-EXTERN:END\nafter',
    );
    expect(extractMarkedBlock(replaced)).toBe('new content');
  });
});
