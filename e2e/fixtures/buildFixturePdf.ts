import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * 視覚検証用のフィクスチャPDF（2ページ、テキスト＋矩形入り）をbase64で生成する。
 *
 * バイナリをリポジトリにコミットせず、テスト実行時にpdf-libで組み立てることで内容を
 * コードで追跡可能にする（src/repositories/document/__test__/pdf.test.tsの
 * buildTestPdfSrcと同じ考え方）
 */
export async function buildFixturePdfBase64(): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const page1 = doc.addPage([400, 300]);
  page1.drawRectangle({ x: 40, y: 200, width: 120, height: 60, color: rgb(0.85, 0.2, 0.2) });
  page1.drawText('Kumihimo Fixture Page 1', { x: 40, y: 260, size: 16, font });

  const page2 = doc.addPage([400, 300]);
  page2.drawRectangle({ x: 220, y: 40, width: 120, height: 60, color: rgb(0.2, 0.4, 0.85) });
  page2.drawText('Kumihimo Fixture Page 2', { x: 40, y: 260, size: 16, font });

  const bytes = await doc.save();
  return Buffer.from(bytes).toString('base64');
}
