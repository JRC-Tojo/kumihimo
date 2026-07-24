import { describe, expect, it } from 'bun:test';
import {
  hasExtensionForImageFormat,
  mimeTypeForImageFormat,
  sniffImageFormat,
} from '../imageSniff';

describe('sniffImageFormat', () => {
  it('PNGシグネチャを判定する', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    expect(sniffImageFormat(bytes)).toBe('png');
  });

  it('JPEGシグネチャを判定する', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00]);
    expect(sniffImageFormat(bytes)).toBe('jpeg');
  });

  it('GIF87aシグネチャを判定する', () => {
    const bytes = new TextEncoder().encode('GIF87a...');
    expect(sniffImageFormat(bytes)).toBe('gif');
  });

  it('GIF89aシグネチャを判定する', () => {
    const bytes = new TextEncoder().encode('GIF89a...');
    expect(sniffImageFormat(bytes)).toBe('gif');
  });

  it('非対応形式（WebP等）や短すぎるバイト列はundefinedを返す', () => {
    expect(sniffImageFormat(new TextEncoder().encode('RIFFxxxxWEBP'))).toBeUndefined();
    expect(sniffImageFormat(new Uint8Array([0x89, 0x50]))).toBeUndefined();
    expect(sniffImageFormat(new Uint8Array([]))).toBeUndefined();
  });

  it('不完全なPNGシグネチャは誤判定しない', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]);
    expect(sniffImageFormat(bytes)).toBeUndefined();
  });
});

describe('mimeTypeForImageFormat', () => {
  it('各形式に対応するMIMEタイプを返す', () => {
    expect(mimeTypeForImageFormat('png')).toBe('image/png');
    expect(mimeTypeForImageFormat('jpeg')).toBe('image/jpeg');
    expect(mimeTypeForImageFormat('gif')).toBe('image/gif');
  });
});

describe('hasExtensionForImageFormat', () => {
  it('拡張子が形式と一致する場合はtrue（大文字小文字を無視）', () => {
    expect(hasExtensionForImageFormat('icon.png', 'png')).toBeTrue();
    expect(hasExtensionForImageFormat('ICON.PNG', 'png')).toBeTrue();
    expect(hasExtensionForImageFormat('photo.jpg', 'jpeg')).toBeTrue();
    expect(hasExtensionForImageFormat('photo.jpeg', 'jpeg')).toBeTrue();
    expect(hasExtensionForImageFormat('anim.gif', 'gif')).toBeTrue();
  });

  it('拡張子が形式と一致しない場合はfalse', () => {
    expect(hasExtensionForImageFormat('icon.jpg', 'png')).toBeFalse();
    expect(hasExtensionForImageFormat('icon', 'png')).toBeFalse();
  });
});
