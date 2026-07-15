import { describe, test, expect } from 'bun:test';
import { parseWorkspaceFile, isRelativeWorkspacePath } from '../vscodeWorkspace';

describe('parseWorkspaceFile', () => {
  test('parses a valid .code-workspace file content', () => {
    const content = JSON.stringify({
      folders: [{ path: './frontend' }, { path: '../backend', name: 'Backend' }],
      settings: { 'editor.tabSize': 2 },
    });

    const result = parseWorkspaceFile(content);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.folders).toEqual([
        { path: './frontend' },
        { path: '../backend', name: 'Backend' },
      ]);
    }
  });

  test('fails for invalid JSON', () => {
    const result = parseWorkspaceFile('not json');
    expect(result.ok).toBe(false);
  });

  test('fails when folders field is missing', () => {
    const result = parseWorkspaceFile(JSON.stringify({ settings: {} }));
    expect(result.ok).toBe(false);
  });
});

describe('isRelativeWorkspacePath', () => {
  test('treats plain relative paths as relative', () => {
    expect(isRelativeWorkspacePath('./frontend')).toBe(true);
    expect(isRelativeWorkspacePath('../backend')).toBe(true);
    expect(isRelativeWorkspacePath('frontend')).toBe(true);
  });

  test('treats POSIX absolute paths as non-relative', () => {
    expect(isRelativeWorkspacePath('/home/user/project')).toBe(false);
  });

  test('treats Windows absolute paths as non-relative', () => {
    expect(isRelativeWorkspacePath('C:\\Users\\me\\project')).toBe(false);
    expect(isRelativeWorkspacePath('D:/projects/app')).toBe(false);
  });
});
