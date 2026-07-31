/**
 * pdf.jsが実行時に追加でフェッチするcMap／標準フォント／WASM（JBIG2・OpenJPEG等）アセットの
 * 配信元設定。`getDocument()`呼び出し側（`src/repositories/document/pdf.ts`・
 * `src/repositories/document/pdfDocumentCache.ts`）で共通して渡す
 *
 * これらはpdfjs-dist内部がファイル名を追加連結して使う「ディレクトリ」参照のため、Viteの静的解析で
 * ハッシュ付き解決される`new URL(path, import.meta.url)`形式では扱えない。`quasar.config.ts`の
 * `vite-plugin-static-copy`でビルド出力・開発サーバー双方の`pdfjs/`配下へディレクトリごとコピーした
 * ファイルを、実行時にルート相対パスとして参照する。`import.meta.env.BASE_URL`はQuasarの
 * `build.publicPath`（開発時`/`、GitHub Pages公開時`/kumihimo/`）を反映するため、
 * 環境ごとに固定文字列を書き分けずに済む
 */
const PDFJS_ASSET_BASE = `${import.meta.env.BASE_URL}pdfjs/`;

export const PDFJS_GET_DOCUMENT_ASSET_OPTIONS = {
  cMapUrl: `${PDFJS_ASSET_BASE}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${PDFJS_ASSET_BASE}standard_fonts/`,
  wasmUrl: `${PDFJS_ASSET_BASE}wasm/`,
} as const;
