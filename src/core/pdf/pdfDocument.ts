import PDFDocument from 'pdfkit';

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
      Author: meta.title,
      Creator: 'Marketplace',
      Subject: meta.subject ?? meta.title,
    },
  });
}

export function pipePdfDocument(
  doc: PDFKit.PDFDocument,
  dest: NodeJS.WritableStream,
): Promise<void> {
  return new Promise((resolve, reject) => {
    dest.on('finish', () => resolve());
    dest.on('error', reject);
    doc.on('error', reject);
    doc.end();
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
