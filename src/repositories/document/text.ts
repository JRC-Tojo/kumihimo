import type { DocumentSource } from 'src/models/document/common';
import { Failure, type Result } from 'src/models/error/result';
import type z from 'zod';

/**
 * BASE64からテキスト情報にデコードする
 *
 * Zodの型定義を与えると、その型でパースした情報を返す
 */
export async function loadTextContents(src: DocumentSource): Promise<Result<string>>;
export async function loadTextContents<T extends z.ZodType>(
  src: DocumentSource,
  targetZodType: T,
): Promise<Result<z.infer<T>>>;
export async function loadTextContents(
  src: DocumentSource,
  targetZodType?: z.ZodType<z.ZodAny>,
): Promise<Result<unknown>> {
  return await new Promise((resolve) => {
    resolve(Failure(new Error('TODO: Not implemented')));
  });
}

/**
 * テキスト情報をBASE64にエンコードする
 *
 * 保存時の前処理を想定
 */
export async function encodeTextContents(text: string): Promise<Result<DocumentSource>> {
  return await new Promise((resolve) => {
    resolve(Failure(new Error('TODO: Not implemented')));
  });
}
