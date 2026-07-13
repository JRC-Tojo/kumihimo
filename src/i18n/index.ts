import enUS from './en-US';
import jaJP from './ja-JP';

// 1. オブジェクトを変数として定義する（型推論させるため）
const locales = {
  'en-US': enUS,
  'ja-JP': jaJP,
};

// 2. オブジェクトのキーからUnion型を作成する（ 'en-US' | 'ja-JP' ）
export type LocaleKey = keyof typeof locales;

// 3. Object.keys() で取得した string[] を、抽出した型でアサーションする
export const localeKeys = Object.keys(locales) as LocaleKey[];

// デフォルトエクスポート
export default locales;
