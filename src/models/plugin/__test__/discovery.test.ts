import { describe, expect, it } from 'bun:test';
import { PluginEntryPointDescriptor, PluginField } from '../discovery';

describe('PluginField', () => {
  it('optionsを省略できる（select以外の型で使用）', () => {
    const result = PluginField.safeParse({
      fieldId: 'startPage',
      label: '開始ページ',
      type: 'number',
      defaultValue: 1,
      optional: true,
    });
    expect(result.success).toBeTrue();
  });

  it('select型はoptionsを持てる', () => {
    const result = PluginField.safeParse({
      fieldId: 'position',
      label: '配置位置',
      type: 'select',
      defaultValue: 'bottom-center',
      options: ['bottom-center', 'bottom-left'],
      optional: true,
    });
    expect(result.success).toBeTrue();
  });
});

describe('PluginEntryPointDescriptor', () => {
  it('fieldsが空配列でもパースできる（引数なしのエントリポイント）', () => {
    const result = PluginEntryPointDescriptor.safeParse({
      entryId: 'stampPageNumbers',
      label: 'ページ番号を配置',
      description: '説明',
      fields: [],
    });
    expect(result.success).toBeTrue();
  });
});
