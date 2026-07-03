/**
 * 文書が更新されたときにPDFのアノテーションを追跡する
 */

import type { DocumentSource } from 'src/models/document/common';
import type { AnnotationStyle } from 'src/models/document/pdf';
import type { Result } from 'src/models/error/result';

/**
 * 旧文書のアノテーションを新文書における位置で上書きして返す
 */
export function trackPdfAnnotation(
  oldSrc: DocumentSource,
  newSrc: DocumentSource,
  config: AnnotationStyle[],
): Promise<Result<AnnotationStyle[]>> {
  // TODO: 実装
}
