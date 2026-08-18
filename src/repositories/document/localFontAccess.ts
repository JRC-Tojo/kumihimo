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
  const query = typeof window !== 'undefined' ? window.queryLocalFonts : undefined;
  if (typeof query !== 'function') {
    return Failure(new Error('このブラウザはLocal Font Access APIに対応していません'));
  }
  try {
    const fonts = await query.call(window);
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
    const boldMatch = candidates.find(
      (f) => /bold/i.test(f.style) && !/italic|oblique/i.test(f.style),
    );
    if (boldMatch) return boldMatch;
  }
  const regularMatch = candidates.find((f) => !/bold|italic|oblique/i.test(f.style));
  return regularMatch ?? candidates[0];
}

/**
 * 汎用フォント名（CSSの`sans-serif`/`serif`/`monospace`相当）に対して、優先的に探す
 * OS実フォント名の候補一覧
 *
 * 汎用名自体はOSにインストールされた実フォントとして列挙されないため、Windows/macOSで
 * 標準的な日本語対応フォント名を中心とした候補から、見つかった最初の1件を採用する
 * （CSSのフォントスタックと同じ考え方）
 */
const GENERIC_FONT_CANDIDATES: Record<string, string[]> = {
  'sans-serif': [
    'Yu Gothic UI',
    'Yu Gothic',
    'Meiryo UI',
    'Meiryo',
    'MS PGothic',
    'MS Gothic',
    'Hiragino Sans',
    'Hiragino Kaku Gothic ProN',
    'Noto Sans JP',
    'Noto Sans CJK JP',
    'Arial',
  ],
  serif: [
    'Yu Mincho',
    'MS PMincho',
    'MS Mincho',
    'Hiragino Mincho ProN',
    'Hiragino Mincho Pro',
    'Noto Serif JP',
    'Noto Serif CJK JP',
    'Times New Roman',
  ],
  monospace: ['MS Gothic', 'Osaka－等幅', 'Noto Sans Mono CJK JP', 'Consolas', 'Courier New'],
};

/**
 * 汎用フォント名（sans-serif/serif/monospace）に対応する候補名リストの中から、
 * OSにインストールされている実フォントを先頭一致で探す
 *
 * どの候補にも一致しない場合、または`genericFamily`が汎用名として定義されていない場合は
 * `undefined`を返す（呼び出し側は標準14フォントへのフォールバックを行うこと）
 */
export function findFontForGenericFamily(
  fonts: FontData[],
  genericFamily: string,
  bold: boolean,
): FontData | undefined {
  const candidates = GENERIC_FONT_CANDIDATES[genericFamily.toLowerCase()];
  if (!candidates) return undefined;

  for (const candidate of candidates) {
    const match = findBestFontMatch(fonts, candidate, bold);
    if (match) return match;
  }
  return undefined;
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
