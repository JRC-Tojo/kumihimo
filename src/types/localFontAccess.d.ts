/**
 * Local Font Access API（`window.queryLocalFonts()`）のアンビエント型定義
 *
 * Chromium系ブラウザ（Chrome/Edge/Opera）専用の実験的APIで、公式の型定義パッケージが
 * 存在しないため、ここで最小限の型を独自に宣言する。実際の利用箇所（対応判定・呼び出し）は
 * `src/repositories/document/localFontAccess.ts`に集約する
 */

interface FontData {
  readonly postscriptName: string;
  readonly fullName: string;
  readonly family: string;
  readonly style: string;
  blob(): Promise<Blob>;
}

interface QueryLocalFontsOptions {
  postscriptNames?: string[];
}

interface Window {
  queryLocalFonts?: (options?: QueryLocalFontsOptions) => Promise<FontData[]>;
}
