/**
 * 画像バイト列の先頭マジックナンバーから実際の形式を判定する共通ユーティリティ
 *
 * プラグインアイコンの表示（data URL生成）・申請時のクライアント側事前検証の両方で使う。
 * サポート形式はストアリポジトリCI（validateIcon.mjs）と合わせてPNG/JPEG/GIFのみとする
 */
export type SniffedImageFormat = 'png' | 'jpeg' | 'gif';

const MIME_TYPE_BY_FORMAT: Record<SniffedImageFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
};

const EXTENSIONS_BY_FORMAT: Record<SniffedImageFormat, string[]> = {
  png: ['.png'],
  jpeg: ['.jpg', '.jpeg'],
  gif: ['.gif'],
};

/**
 * バイト列の先頭マジックナンバーから画像形式を判定する。
 * PNG/JPEG/GIF以外（WebP/BMP/SVG等）は非対応のためundefinedを返す
 * （呼び出し側で「非対応形式」として扱い、決してPNG等に読み替えないこと。
 * 誤った形式をdata URLのMIMEに使うと、画像デコーダが実バイトを解釈できず表示に失敗する）
 */
export function sniffImageFormat(bytes: Uint8Array): SniffedImageFormat | undefined {
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  // "GIF87a" または "GIF89a" のいずれか（不完全なシグネチャの誤判定を防ぐため6バイト全体を照合する）
  if (bytes.length >= 6) {
    const header = new TextDecoder('ascii').decode(bytes.subarray(0, 6));
    if (header === 'GIF87a' || header === 'GIF89a') return 'gif';
  }
  return undefined;
}

/** 画像形式に対応するMIMEタイプ文字列を返す（data URL生成に使う） */
export function mimeTypeForImageFormat(format: SniffedImageFormat): string {
  return MIME_TYPE_BY_FORMAT[format];
}

/**
 * ファイル名の拡張子が、指定した画像形式のものとして妥当かどうか（大文字小文字を無視）
 *
 * raw.githubusercontent.comはContent-Typeを実バイトではなく拡張子から決定し、かつ
 * `X-Content-Type-Options: nosniff`を付与するため、拡張子が実形式と食い違っていると
 * ブラウザが画像として表示できない（text/plain等として扱われる）。申請前にこの不一致を
 * 検出することで、公開後にアイコンだけ表示されないという事態を防ぐ
 */
export function hasExtensionForImageFormat(fileName: string, format: SniffedImageFormat): boolean {
  const lower = fileName.toLowerCase();
  return EXTENSIONS_BY_FORMAT[format].some((ext) => lower.endsWith(ext));
}
