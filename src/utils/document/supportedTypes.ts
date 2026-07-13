import { SUPPORTED_DOCUMENT_EXTS } from 'src/models/document/common';
import { Path } from 'src/utils/binary/path';

export type SupportedDocumentKind = 'pdf' | 'text' | 'unsupported';

/**
 * ファイルパスの拡張子から、本システムが表示可能な文書種別を判定する
 */
export function getSupportedDocumentKind(path: string): SupportedDocumentKind {
  const ext = new Path(path).extname().toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if ((SUPPORTED_DOCUMENT_EXTS as readonly string[]).includes(ext)) return 'text';
  return 'unsupported';
}

/**
 * ファイルパスが本システムで表示可能な拡張子かどうかを返す
 */
export function isSupportedDocument(path: string): boolean {
  return getSupportedDocumentKind(path) !== 'unsupported';
}
