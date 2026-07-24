import { describe, expect, it } from 'bun:test';
import { parseSubmissionDraft } from '../manifest';

const validManifest = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'ページ番号スタンパー',
  version: '1.0.0',
  description: '説明',
  runtime: 'wasm',
  mainFile: 'page_number_stamper.wasm',
  requiredHostApis: [],
};

const validDraft = {
  name: 'ページ番号スタンパー',
  version: '1.0.0',
  description: '説明',
  runtime: 'wasm',
  mainFile: 'page_number_stamper.wasm',
  requiredHostApis: [],
};

describe('parseSubmissionDraft', () => {
  it('id/ownerを持たないフォーム入力を検証できる', () => {
    const result = parseSubmissionDraft(validDraft);
    expect(result.ok).toBeTrue();
    if (!result.ok) return;
    expect(result.value.name).toBe(validDraft.name);
    expect((result.value as Record<string, unknown>).id).toBeUndefined();
  });

  it('idが混入していても、検証結果からは取り除かれる（omitされたフィールドのため）', () => {
    const result = parseSubmissionDraft({ ...validManifest });
    expect(result.ok).toBeTrue();
    if (!result.ok) return;
    expect((result.value as Record<string, unknown>).id).toBeUndefined();
  });

  it('mainFileにtraversalを含むパスが指定された場合は検証エラーになる', () => {
    expect(parseSubmissionDraft({ ...validDraft, mainFile: '../outside.wasm' }).ok).toBeFalse();
  });

  it('runtimeが不正な場合は検証エラーになる', () => {
    expect(parseSubmissionDraft({ ...validDraft, runtime: 'native' }).ok).toBeFalse();
  });

  it('nameが空文字の場合は検証エラーになる', () => {
    expect(parseSubmissionDraft({ ...validDraft, name: '' }).ok).toBeFalse();
  });

  it('requiredHostApisを省略した場合は空配列になる', () => {
    const withoutApis = {
      name: validDraft.name,
      version: validDraft.version,
      description: validDraft.description,
      runtime: validDraft.runtime,
      mainFile: validDraft.mainFile,
    };
    const result = parseSubmissionDraft(withoutApis);
    expect(result.ok).toBeTrue();
    if (!result.ok) return;
    expect(result.value.requiredHostApis).toEqual([]);
  });
});
