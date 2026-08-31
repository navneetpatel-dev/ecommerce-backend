import {
  PDF_CELL_PAD,
  PDF_COLOR,
  PDF_FONT,
  PDF_HDR_FONT_SIZE,
  PDF_NAME_FONT_SIZE,
  PDF_NUM_FONT_SIZE,
  PDF_PAGE,
} from './pdfTheme';
import type { PdfColumn } from './pdfText';
import { drawBoundedText } from './pdfText';

export function drawSectionBand(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  eyebrow: string,
  title: string,
  meta?: string,
) {
  doc.save();
  doc.rect(x, y, width, height).fill(PDF_COLOR.brandSubtle);
  doc.font(PDF_FONT.regular).fontSize(6.5).fillColor(PDF_COLOR.brandHover);
  doc.text(eyebrow.toUpperCase(), x + 12, y + 3, { width: width - 24, lineBreak: false });
  doc.font(PDF_FONT.bold).fontSize(9).fillColor(PDF_COLOR.ink);
  doc.text(title, x + 12, y + 11, {
    width: width * 0.42,
    lineBreak: false,
    ellipsis: true,
  });
  if (meta) {
    doc.font(PDF_FONT.regular).fontSize(8).fillColor(PDF_COLOR.inkMuted);
    doc.text(meta, x + width * 0.46, y + 8, {
      width: width * 0.52,
      lineBreak: false,
      ellipsis: true,
    });
  }
  doc.restore();
}

export function drawTableHeader(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  tableWidth: number,
  cols: PdfColumn[],
) {
  doc.save();
  doc.rect(x, y, tableWidth, 16).fill(PDF_COLOR.brand);
  let cx = x;
  for (const col of cols) {
    doc.font(PDF_FONT.bold).fontSize(PDF_HDR_FONT_SIZE).fillColor(PDF_COLOR.white);
    doc.text(col.label.toUpperCase(), cx + PDF_CELL_PAD, y + 5, {
      width: col.width - PDF_CELL_PAD * 2,
      align: col.align,
      lineBreak: false,
    });
    cx += col.width;
  }
  doc.restore();
}

export type PdfPrimaryCell = {
  title: string;
  subtitle?: string;
};

export function measureTableRowHeight(
  doc: PDFKit.PDFDocument,
  cols: PdfColumn[],
  primary?: PdfPrimaryCell,
): number {
  const nameCol = cols[0];
  if (!nameCol || !primary) return 20;
  const textW = nameCol.width - PDF_CELL_PAD * 2;
  doc.font(PDF_FONT.bold).fontSize(PDF_NAME_FONT_SIZE);
  const titleH = doc.heightOfString(primary.title, { width: textW });
  let extra = 0;
  if (primary.subtitle) {
    doc.font(PDF_FONT.regular).fontSize(7);
    extra = 2 + doc.heightOfString(primary.subtitle, { width: textW });
  }
  return Math.max(20, titleH + extra + 8);
}

export function drawTableRow(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  tableWidth: number,
  rowHeight: number,
  cols: PdfColumn[],
  values: Record<string, string>,
  stripeIndex: number,
  primary?: PdfPrimaryCell,
) {
  doc.save();
  doc.rect(x, y, tableWidth, rowHeight)
    .fill(stripeIndex % 2 === 0 ? PDF_COLOR.surface : PDF_COLOR.brandSubtle);
  doc.restore();

  doc.save();
  doc.rect(x, y, tableWidth, rowHeight).clip();

  let cx = x;
  for (const col of cols) {
    if (col.key === cols[0]?.key && primary) {
      const textW = col.width - PDF_CELL_PAD * 2;
      doc.font(PDF_FONT.bold).fontSize(PDF_NAME_FONT_SIZE).fillColor(PDF_COLOR.ink);
      const titleH = doc.heightOfString(primary.title, { width: textW });
      doc.text(primary.title, cx + PDF_CELL_PAD, y + 5, { width: textW });
      if (primary.subtitle) {
        doc.font(PDF_FONT.regular).fontSize(7).fillColor(PDF_COLOR.inkFaint);
        doc.text(primary.subtitle, cx + PDF_CELL_PAD, y + 5 + titleH, {
          width: textW,
          lineBreak: false,
          ellipsis: true,
        });
      }
    } else {
      drawBoundedText(doc, values[col.key] ?? '', cx, y + 5, col.width, {
        color: PDF_COLOR.inkMuted,
        align: col.align,
        ellipsis: col.align === 'left',
      });
    }
    cx += col.width;
  }
  doc.restore();

  doc.moveTo(x, y + rowHeight).lineTo(x + tableWidth, y + rowHeight)
    .strokeColor(PDF_COLOR.line).lineWidth(0.4).stroke();
}

export function drawContinuationLabel(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  label: string,
): number {
  doc.font(PDF_FONT.bold).fontSize(8).fillColor(PDF_COLOR.brandHover);
  doc.text(label, x, y, { width, lineBreak: false, ellipsis: true });
  return 14;
}
