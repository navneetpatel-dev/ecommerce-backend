import {
  PDF_COLOR,
  PDF_FONT,
  PDF_PAGE,
} from './pdfTheme';

export type PdfTotalsLine = { label: string; value: string };

export type PdfTotalsOptions = {
  lines: PdfTotalsLine[];
  grandTotalLabel: string;
  grandTotalValue: string;
};

const H_PAD = 12;
const LABEL_VALUE_GAP = 8;
const VALUE_TAIL_PAD = 4;

function measureLabelColW(
  doc: PDFKit.PDFDocument,
  lines: PdfTotalsLine[],
  grandTotalLabel: string,
): number {
  doc.font(PDF_FONT.regular).fontSize(8);
  let max = 0;
  for (const line of lines) {
    max = Math.max(max, doc.widthOfString(line.label));
  }
  doc.font(PDF_FONT.bold).fontSize(8);
  max = Math.max(max, doc.widthOfString(grandTotalLabel.toUpperCase()));
  return Math.ceil(max) + LABEL_VALUE_GAP;
}

function measureValueColW(
  doc: PDFKit.PDFDocument,
  lines: PdfTotalsLine[],
  grandTotalValue: string,
): number {
  doc.font(PDF_FONT.regular).fontSize(8.5);
  let max = 0;
  for (const line of lines) {
    max = Math.max(max, doc.widthOfString(line.value));
  }
  doc.font(PDF_FONT.bold).fontSize(10);
  max = Math.max(max, doc.widthOfString(grandTotalValue));
  return Math.ceil(max) + VALUE_TAIL_PAD;
}

function measureTotalsBoxWidth(
  doc: PDFKit.PDFDocument,
  lines: PdfTotalsLine[],
  grandTotalLabel: string,
  grandTotalValue: string,
  maxWidth: number,
): number {
  const labelColW = measureLabelColW(doc, lines, grandTotalLabel);
  const valueColW = measureValueColW(doc, lines, grandTotalValue);
  return Math.min(maxWidth, H_PAD + labelColW + valueColW + H_PAD);
}

function roundedTopRectPath(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  doc.moveTo(x + r, y)
    .lineTo(x + w - r, y)
    .quadraticCurveTo(x + w, y, x + w, y + r)
    .lineTo(x + w, y + h)
    .lineTo(x, y + h)
    .lineTo(x, y + r)
    .quadraticCurveTo(x, y, x + r, y)
    .closePath();
}

function roundedBottomRectPath(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  doc.moveTo(x, y)
    .lineTo(x + w, y)
    .lineTo(x + w, y + h - r)
    .quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    .lineTo(x + r, y + h)
    .quadraticCurveTo(x, y + h, x, y + h - r)
    .closePath();
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
  roundedBottomRectPath(doc, x, y, boxW, barH, PDF_PAGE.radius);
  doc.fill(PDF_COLOR.ink);

  const labelX = x + H_PAD;
  const valueX = x + H_PAD + labelColW;

  doc.font(PDF_FONT.bold).fontSize(8).fillColor(PDF_COLOR.white);
  const labelY = y + (barH - doc.currentLineHeight(false)) / 2;
  doc.text(grandTotalLabel.toUpperCase(), labelX, labelY, {
    width: labelColW,
    lineBreak: false,
  });

  doc.font(PDF_FONT.bold).fontSize(10).fillColor(PDF_COLOR.white);
  const valueY = y + (barH - doc.currentLineHeight(false)) / 2;
  doc.text(grandTotalValue, valueX, valueY, {
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
  const grandBarH = 36;
  const summaryH = summaryPad + lines.length * rowH + summaryPad;
  const boxH = summaryH + grandBarH;
  const labelColW = measureLabelColW(doc, lines, grandTotalLabel);
  const valueColW = measureValueColW(doc, lines, grandTotalValue);
  const labelX = x + H_PAD;
  const valueX = x + H_PAD + labelColW;

  doc.save();
  doc.fillColor(PDF_COLOR.surface).strokeColor(PDF_COLOR.line).lineWidth(0.8);
  roundedTopRectPath(doc, x, y, boxW, summaryH, PDF_PAGE.radius);
  doc.fillAndStroke();
  let rowY = y + summaryPad;
  for (const line of lines) {
    doc.font(PDF_FONT.regular).fontSize(8).fillColor(PDF_COLOR.inkMuted);
    doc.text(line.label, labelX, rowY, { width: labelColW, lineBreak: false });
    doc.font(PDF_FONT.regular).fontSize(8.5).fillColor(PDF_COLOR.ink);
    doc.text(line.value, valueX, rowY, {
      width: valueColW,
      align: 'right',
      lineBreak: false,
    });
    rowY += rowH;
  }
  const totalY = y + summaryH;
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
