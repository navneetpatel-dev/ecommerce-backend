import PDFDocument from 'pdfkit';
import { PDF_BRAND } from './pdfTheme';

export type BrandedPdfMeta = {
  title: string;
  subject?: string;
};

export function createBrandedPdfDocument(meta: BrandedPdfMeta): PDFKit.PDFDocument {
  return new PDFDocument({
    size: 'A4',
    margin: 0,
    info: {
      Title: meta.title,
      Author: PDF_BRAND.name,
      Creator: PDF_BRAND.name,
      Subject: meta.subject ?? meta.title,
    },
  });
}

export function finalizePdfDocument(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}
