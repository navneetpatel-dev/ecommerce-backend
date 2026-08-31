import {
  PDF_BRAND,
  PDF_COLOR,
  PDF_FONT,
  PDF_PAGE,
} from './pdfTheme';

export function paintPaper(doc: PDFKit.PDFDocument) {
  const { width, height } = doc.page;
  doc.save();
  doc.rect(0, 0, width, height).fill(PDF_COLOR.paper);
  doc.restore();
}

export function drawPdfFooter(doc: PDFKit.PDFDocument, footerNote = PDF_BRAND.computerGenerated) {
  const { width, height } = doc.page;
  const y = height - PDF_PAGE.footerH;
  const contentWidth = width - PDF_PAGE.margin * 2;
  const fontSize = 7.5;
  doc.save();
  doc.moveTo(PDF_PAGE.margin, y).lineTo(width - PDF_PAGE.margin, y)
    .strokeColor(PDF_COLOR.lineStrong).lineWidth(0.8).stroke();
  doc.font(PDF_FONT.regular).fontSize(fontSize).fillColor(PDF_COLOR.inkFaint);
  // Center the disclaimer in the footer band under the rule.
  const textY = y + (PDF_PAGE.footerH - fontSize) / 2;
  doc.text(footerNote, PDF_PAGE.margin, textY, {
    width: contentWidth,
    align: 'center',
    lineBreak: false,
  });
  doc.restore();
}

export function drawPdfFirstHeader(
  doc: PDFKit.PDFDocument,
  title: string,
  rightLabel = 'Original for Recipient',
) {
  const { width } = doc.page;
  const titleSize = 18;
  const labelSize = 8;
  const rightWidth = 160;
  const contentWidth = width - PDF_PAGE.margin * 2;
  // Vertically center both lines on the same midline of the header bar.
  const titleY = (PDF_PAGE.headerH - titleSize) / 2;
  const labelY = (PDF_PAGE.headerH - labelSize) / 2;

  doc.save();
  doc.rect(0, 0, width, PDF_PAGE.headerH).fill(PDF_COLOR.ink);
  doc.rect(0, PDF_PAGE.headerH, width, PDF_PAGE.goldH).fill(PDF_COLOR.brand);

  doc.font(PDF_FONT.bold).fontSize(titleSize).fillColor(PDF_COLOR.white);
  doc.text(title, PDF_PAGE.margin, titleY, {
    width: contentWidth - rightWidth - 12,
    lineBreak: false,
    ellipsis: true,
  });

  doc.font(PDF_FONT.regular).fontSize(labelSize).fillColor(PDF_COLOR.inkFaint);
  doc.text(rightLabel, width - PDF_PAGE.margin - rightWidth, labelY, {
    width: rightWidth,
    align: 'right',
    lineBreak: false,
  });
  doc.restore();
}

export function drawPdfContinuedHeader(
  doc: PDFKit.PDFDocument,
  title: string,
  continuationLabel = 'Continued',
) {
  const { width } = doc.page;
  const barH = 36;
  const fontSize = 9;
  const rightWidth = 80;
  const textY = (barH - fontSize) / 2;

  doc.save();
  doc.rect(0, 0, width, barH).fill(PDF_COLOR.ink);
  doc.rect(0, barH, width, 2).fill(PDF_COLOR.brand);
  doc.font(PDF_FONT.regular).fontSize(fontSize).fillColor(PDF_COLOR.white);
  doc.text(title, PDF_PAGE.margin, textY, {
    width: width - PDF_PAGE.margin * 2 - rightWidth - 12,
    lineBreak: false,
    ellipsis: true,
  });
  doc.fillColor(PDF_COLOR.inkFaint);
  doc.text(continuationLabel, width - PDF_PAGE.margin - rightWidth, textY, {
    width: rightWidth,
    align: 'right',
    lineBreak: false,
  });
  doc.restore();
}
