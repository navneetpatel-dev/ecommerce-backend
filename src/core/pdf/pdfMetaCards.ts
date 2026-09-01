import {
  PDF_COLOR,
  PDF_FONT,
  PDF_PAGE,
} from './pdfTheme';
import { measureTextHeight } from './pdfText';

export type PdfMetaTone = 'ink' | 'muted' | 'status';

export type PdfMetaRow = {
  label: string;
  value: string;
  tone?: PdfMetaTone;
  statusColor?: string;
  valueAlign?: 'left' | 'right';
};

export function drawPdfMetaCards(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  contentWidth: number,
  left: PdfMetaRow[],
  right: PdfMetaRow[],
  statusColor?: string,
  options?: { rightValueAlign?: 'left' | 'right' },
): number {
  const cardW = (contentWidth - PDF_PAGE.gutter) / 2;
  const cardH = Math.max(
    measureMetaCardHeight(doc, cardW, left),
    measureMetaCardHeight(doc, cardW, right),
  );
  drawMetaCard(doc, x, y, cardW, cardH, left, statusColor);
  drawMetaCard(
    doc,
    x + cardW + PDF_PAGE.gutter,
    y,
    cardW,
    cardH,
    right,
    statusColor,
    options?.rightValueAlign,
  );
  return cardH;
}

function metaValueWidth(cardW: number, hasLabel: boolean): number {
  return cardW - 24 - (hasLabel ? 78 : 0);
}

function measureMetaCardHeight(
  doc: PDFKit.PDFDocument,
  cardW: number,
  rows: PdfMetaRow[],
): number {
  let h = 18;
  for (const row of rows) {
    h += Math.max(
      14,
      measureTextHeight(doc, row.value, metaValueWidth(cardW, Boolean(row.label)), {
        bold: row.tone !== 'muted',
        size: 8.5,
        lineBreak: true,
      }),
    ) + 4;
  }
  return h;
}

function resolveToneColor(row: PdfMetaRow, statusColor?: string): string {
  if (row.tone === 'status' && statusColor) return statusColor;
  if (row.tone === 'muted') return PDF_COLOR.inkMuted;
  return PDF_COLOR.ink;
}

function drawMetaCard(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  rows: PdfMetaRow[],
  statusColor?: string,
  defaultValueAlign: 'left' | 'right' = 'left',
) {
  doc.save();
  doc.fillColor(PDF_COLOR.surface).strokeColor(PDF_COLOR.line).lineWidth(0.8);
  doc.roundedRect(x, y, w, h, PDF_PAGE.radius).fillAndStroke();
  let rowY = y + 10;
  const labelW = 78;
  for (const row of rows) {
    if (row.label) {
      doc.font(PDF_FONT.regular).fontSize(7).fillColor(PDF_COLOR.inkFaint);
      doc.text(row.label.toUpperCase(), x + 12, rowY + 1, {
        width: labelW - 4,
        lineBreak: false,
      });
    }
    const valueX = x + 12 + (row.label ? labelW : 0);
    const valueW = metaValueWidth(w, Boolean(row.label));
    doc.font(row.tone === 'muted' ? PDF_FONT.regular : PDF_FONT.bold)
      .fontSize(8.5)
      .fillColor(resolveToneColor(row, statusColor));
    const valueH = doc.heightOfString(row.value, { width: valueW });
    doc.text(row.value, valueX, rowY, {
      width: valueW,
      align: row.valueAlign ?? defaultValueAlign,
      lineBreak: true,
    });
    rowY += Math.max(14, valueH) + 4;
  }
  doc.restore();
}
