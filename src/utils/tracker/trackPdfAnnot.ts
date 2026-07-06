/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * 文書が更新されたときにPDFのアノテーションを追跡する
 */

import type { DocumentSource } from 'src/models/document/common';
import type { AnnotationStyle } from 'src/models/document/pdf';
import { Failure, Success, type Result } from 'src/models/error/result';

/**
 * 旧文書のアノテーションを新文書における位置で上書きして返す
 */
export function trackPdfAnnotation(
  oldSrc: DocumentSource,
  newSrc: DocumentSource,
  annotStyles: AnnotationStyle[],
): Promise<Result<AnnotationStyle[]>> {
  // TODO: 与えられた`config`内のアノテーション情報を更新する処理を追加
  return new Promise((resolve) => resolve(Success(annotStyles)));
}
