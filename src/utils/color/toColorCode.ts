/**
 * 未検証の文字列をColorCode（ブランド付き文字列）へ変換する
 *
 * カラーピッカー等から来る生の文字列はZodスキーマでの検証前のため、不正な値を
 * 誤って配置済みアノテーション等に書き込まないよう、必ずこの関数を経由して検証する
 */
import { ColorCode } from 'src/models/document/pdf';

export function toColorCode(value: string | undefined): ColorCode | undefined {
  if (value === undefined) return undefined;
  const parsed = ColorCode.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
