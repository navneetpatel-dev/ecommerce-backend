import {
  PDF_COLOR,
  PDF_FONT,
  PDF_PAGE,
} from './pdfTheme';
import { measureTextHeight } from './pdfText';

export type PdfTotalsLine = { label: string; value: string };

export type PdfTotalsOptions = {
  lines: PdfTotalsLine[];
  grandTotalLabel: string;
  grandTotalValue: string;
};

function measureTotalsBoxWidth(
  doc: PDFKit.PDFDocument,
  lines: PdfTotalsLine[],
  grandTotalLabel: string,
  grandTotalValue: string,
  maxWidth: number,
): number {
  let labelW = 0;
  let valueW = 0;
  doc.font(PDF_FONT.regular).fontSize(8);
  for (const line of lines) {
    labelW = Math.max(labelW, doc.widthOfString(line.label));
    valueW = Math.max(valueW, doc.widthOfString(line.value));
  }
  doc.font(PDF_FONT.bold).fontSize(10);
  valueW = Math.max(valueW, doc.widthOfString(grandTotalValue));
  doc.font(PDF_FONT.bold).fontSize(8);
  labelW = Math.max(labelW, doc.widthOfString(grandTotalLabel.toUpperCase()));
  return Math.min(maxWidth, Math.ceil(labelW + valueW + 48));
}

function drawGrandTotalBar(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  boxW: number,
  labelColW: number,
  valueColW: number,
  grandTotalLabel: string,
  grandTotalValue: string,
) {
  const barH = 36;
  doc.roundedRect(x, y, boxW, barH, PDF_PAGE.radius).fill(PDF_COLOR.ink);

  doc.font(PDF_FONT.bold).fontSize(8).fillColor(PDF_COLOR.brand);
  const labelH = measureTextHeight(doc, grandTotalLabel.toUpperCase(), labelColW, {
    bold: true,
    size: 8,
    lineBreak: false,
  });
  doc.text(grandTotalLabel.toUpperCase(), x + 12, y + (barH - labelH) / 2, {
    width: labelColW,
    lineBreak: false,
  });

  doc.font(PDF_FONT.bold).fontSize(10).fillColor(PDF_COLOR.white);
  const amountH = measureTextHeight(doc, grandTotalValue, valueColW, {
    bold: true,
    size: 10,
    lineBreak: false,
  });
  doc.text(grandTotalValue, x + 12 + labelColW, y + (barH - amountH) / 2, {
    width: valueColW,
    align: 'right',
    lineBreak: false,
  });
}

export function drawPdfTotalsBox(
  doc: PDFKit.PDFDocument,
  marginX: number,
  y: number,
  contentWidth: number,
  options: PdfTotalsOptions,
): number {
  const { lines, grandTotalLabel, grandTotalValue } = options;
  const boxW = measureTotalsBoxWidth(
    doc,
    lines,
    grandTotalLabel,
    grandTotalValue,
    contentWidth,
  );
  const x = marginX + contentWidth - boxW;
  const summaryPad = 10;
  const rowH = 16;
  const grandGap = 4;
  const grandBarH = 36;
  const summaryH = summaryPad + lines.length * rowH + summaryPad;
  const boxH = summaryH + grandGap + grandBarH;
  const labelColW = Math.min(120, Math.floor(boxW * 0.42));
  const valueColW = boxW - labelColW - 24;

  doc.save();
  doc.fillColor(PDF_COLOR.surface).strokeColor(PDF_COLOR.line).lineWidth(0.8);
  doc.roundedRect(x, y, boxW, summaryH, PDF_PAGE.radius).fillAndStroke();
  let rowY = y + summaryPad;
  for (const line of lines) {
    doc.font(PDF_FONT.regular).fontSize(8).fillColor(PDF_COLOR.inkMuted);
    doc.text(line.label, x + 12, rowY, { width: labelColW, lineBreak: false });
    doc.font(PDF_FONT.regular).fontSize(8.5).fillColor(PDF_COLOR.ink);
    doc.text(line.value, x + 12 + labelColW, rowY, {
      width: valueColW,
      align: 'right',
      lineBreak: false,
    });
    rowY += rowH;
  }
  const totalY = y + summaryH + grandGap;
  drawGrandTotalBar(
    doc,
    x,
    totalY,
    boxW,
    labelColW,
    valueColW,
    grandTotalLabel,
    grandTotalValue,
  );
  doc.restore();
  return boxH;
}

export function drawPdfHighlightBox(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  eyebrow: string,
  body: string,
): number {
  doc.font(PDF_FONT.bold).fontSize(9);
  const textH = doc.heightOfString(body, { width: width - 24, lineBreak: true });
  const boxH = Math.max(36, textH + 24);

  doc.save();
  doc.fillColor(PDF_COLOR.brandSubtle).strokeColor(PDF_COLOR.line).lineWidth(0.8);
  doc.roundedRect(x, y, width, boxH, PDF_PAGE.radius).fillAndStroke();
  doc.font(PDF_FONT.regular).fontSize(7).fillColor(PDF_COLOR.brandHover);
  doc.text(eyebrow.toUpperCase(), x + 12, y + 7, { lineBreak: false });
  doc.font(PDF_FONT.bold).fontSize(9).fillColor(PDF_COLOR.ink);
  doc.text(body, x + 12, y + 18, { width: width - 24, lineBreak: true });
  doc.restore();
  return boxH;
}
