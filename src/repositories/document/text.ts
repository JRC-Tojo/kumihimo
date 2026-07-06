import type { DocumentSource } from 'src/models/document/common';
import { Success, Failure, type Result } from 'src/models/error/result';
import type z from 'zod';

/**
 * BASE64からテキスト情報にデコードする
 *
 * Zodの型定義を与えると、その型でパースした情報を返す
 */
export function loadTextContents(src: DocumentSource): Result<string>;
export function loadTextContents<T extends z.ZodType>(
  src: DocumentSource,
  targetZodType: T,
): Result<z.infer<T>>;
export function loadTextContents(src: DocumentSource, targetZodType?: z.ZodType): Result<unknown> {
  try {
    // 1. BASE64文字列をUTF-8のテキストにデコード
    const binaryString = atob(src);
    const bytes = Uint8Array.from(binaryString, (c) => c.charCodeAt(0));
    const decodedText = new TextDecoder().decode(bytes);

    // 2. Zodの型定義が与えられている場合
    if (targetZodType) {
      // 任意のデータをBASE64化している場合、元データはJSONであることが多いためパースします
      // （もし単なる文字列に対してZodを使う場合は、このJSON.parseは外してください）
      const parsedData = JSON.parse(decodedText);

      // Zodの safeParse を使って例外を出さずに安全にバリデーション
      const validationResult = targetZodType.safeParse(parsedData);

      if (!validationResult.success) {
        return Failure(new Error(`Validation failed: ${validationResult.error.message}`));
      }
      return Success(validationResult.data);
    }

    // 3. 型定義がない場合は、デコードしたテキストをそのまま返す
    return Success(decodedText);
  } catch (error) {
    if (error instanceof Error) {
      return Failure(error);
    }
    return Failure(new Error('An unexpected error occurred during decoding.'));
  }
}

/**
 * テキスト情報をBASE64にエンコードする
 *
 * 保存時の前処理を想定
 */
export function encodeTextContents(text: string): Result<DocumentSource> {
  try {
    // 文字列をBASE64にエンコード
    const bytes = new TextEncoder().encode(text);
    const binaryString = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
    const base64Text = btoa(binaryString);

    return Success(base64Text as DocumentSource);
  } catch (error) {
    if (error instanceof Error) {
      return Failure(error);
    }
    return Failure(new Error('An unexpected error occurred during encoding.'));
  }
}
