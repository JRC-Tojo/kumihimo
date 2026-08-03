/**
 * pdf.jsの標準14フォント（Helvetica等、PDF側に埋め込まれていない場合）を描画するために
 * 必要なフォールバック用フォントデータのURL
 *
 * プロジェクトには同梱せず、インストール済みのpdfjs-distと同一バージョンのものをCDN（jsDelivr）
 * から都度取得する。バージョンを固定参照することで、pdfjs-dist更新時にもズレが生じない
 */
import { version } from 'pdfjs-dist';

export const PDF_STANDARD_FONT_DATA_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/standard_fonts/`;
