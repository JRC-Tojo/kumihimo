import { describe, expect, it } from 'bun:test';
import { PluginManifest } from '../manifest';

const validManifest = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'ページ番号スタンパー',
  version: '1.0.0',
  description: '説明',
  runtime: 'wasm',
  mainFile: 'page_number_stamper.wasm',
  requiredHostApis: ['ui.reportProgress', 'plan.addAnnotation'],
};

describe('PluginManifest', () => {
  it('正常なマニフェストをパースできる', () => {
    const result = PluginManifest.safeParse(validManifest);
    expect(result.success).toBeTrue();
  });

  it('entryPointsフィールドを持たない（静的記述しない設計であることの確認）', () => {
    const parsed = PluginManifest.parse(validManifest);
    expect((parsed as Record<string, unknown>).entryPoints).toBeUndefined();
  });

  it('requiredHostApisを省略した場合は空配列になる', () => {
    const withoutApis = {
      id: validManifest.id,
      name: validManifest.name,
      version: validManifest.version,
      description: validManifest.description,
      runtime: validManifest.runtime,
      mainFile: validManifest.mainFile,
    };
    const parsed = PluginManifest.parse(withoutApis);
    expect(parsed.requiredHostApis).toEqual([]);
  });

  it('未知のrequiredHostApisが含まれる場合は検証エラーになる', () => {
    const result = PluginManifest.safeParse({
      ...validManifest,
      requiredHostApis: ['not.a.real.api'],
    });
    expect(result.success).toBeFalse();
  });

  it('runtimeが"wasm"/"pyodide"以外の場合は検証エラーになる', () => {
    const result = PluginManifest.safeParse({ ...validManifest, runtime: 'native' });
    expect(result.success).toBeFalse();
  });

  it('idが空文字の場合は検証エラーになる', () => {
    const result = PluginManifest.safeParse({ ...validManifest, id: '' });
    expect(result.success).toBeFalse();
  });

  it('idがUUID形式でない場合は検証エラーになる（開発者が任意の文字列を指定できないようにする対策）', () => {
    for (const invalidId of [
      '../etc/passwd',
      'wasm-page-number-stamper',
      'not-a-uuid',
      '11111111-1111-1111-1111-111111111111', // version 4 ではない
    ]) {
      const result = PluginManifest.safeParse({ ...validManifest, id: invalidId });
      expect(result.success).toBeFalse();
    }
  });

  it('mainFile/iconFileにtraversalを含むパスが指定された場合は検証エラーになる', () => {
    expect(
      PluginManifest.safeParse({ ...validManifest, mainFile: '../outside.wasm' }).success,
    ).toBe(false);
    expect(PluginManifest.safeParse({ ...validManifest, iconFile: '../../icon.png' }).success).toBe(
      false,
    );
    expect(PluginManifest.safeParse({ ...validManifest, mainFile: '/etc/passwd' }).success).toBe(
      false,
    );
  });
});
