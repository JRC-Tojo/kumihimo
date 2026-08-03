/**
 * Local Font Access API（`window.queryLocalFonts()`）のラッパー
 *
 * OSにインストールされている実フォントを列挙・取得する。Chromium系ブラウザ（Chrome/Edge/Opera）の
 * みが対応しており、初回呼び出し時にユーザーへの許可プロンプトが表示される（ユーザー操作
 * ＝クリック等のイベントハンドラ内から呼ぶ必要があり、マウント時の自動呼び出し等では動作しない）。
 * 非対応ブラウザ（Firefox/Safari等）では`isLocalFontAccessSupported`がfalseを返すため、
 * 呼び出し側は必ずこれで分岐し、汎用フォント（sans-serif/serif/monospace）へフォールバックすること
 */
import { Failure, Success, toError, type Result } from 'src/models/error/result';

/** このブラウザがLocal Font Access APIに対応しているかどうか */
export function isLocalFontAccessSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.queryLocalFonts === 'function';
}

/**
 * OSにインストールされているフォント一覧を取得する（ユーザー操作のハンドラ内から呼ぶこと）
 *
 * 初回はブラウザの許可プロンプトが表示され、ユーザーが拒否した場合はFailureを返す
 */
export async function queryLocalFonts(): Promise<Result<FontData[]>> {
  if (!isLocalFontAccessSupported()) {
    return Failure(new Error('このブラウザはLocal Font Access APIに対応していません'));
  }
  try {
    const fonts = await window.queryLocalFonts!();
    return Success(fonts);
  } catch (e) {
    return Failure(toError(e));
  }
}

/**
 * フォント一覧から、指定したファミリー名・太さに最も合う1件を選ぶ
 *
 * 同じファミリーでも太さ・スタイルごとに別々のFontDataとして列挙されるため、
 * boldがtrueの場合は"Bold"を含むstyleを優先し、無ければ最初の一致にフォールバックする
 */
export function findBestFontMatch(
  fonts: FontData[],
  family: string,
  bold: boolean,
): FontData | undefined {
  const candidates = fonts.filter((f) => f.family.toLowerCase() === family.toLowerCase());
  if (candidates.length === 0) return undefined;

  if (bold) {
    const boldMatch = candidates.find((f) => /bold/i.test(f.style) && !/italic|oblique/i.test(f.style));
    if (boldMatch) return boldMatch;
  }
  const regularMatch = candidates.find((f) => !/bold|italic|oblique/i.test(f.style));
  return regularMatch ?? candidates[0];
}

/** 指定したFontDataの実データ（フォントファイルのバイト列）を取得する */
export async function getFontBytes(fontData: FontData): Promise<Result<Uint8Array>> {
  try {
    const blob = await fontData.blob();
    const buffer = await blob.arrayBuffer();
    return Success(new Uint8Array(buffer));
  } catch (e) {
    return Failure(toError(e));
  }
}
