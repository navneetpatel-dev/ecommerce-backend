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
  doc.save();
  doc.moveTo(PDF_PAGE.margin, y).lineTo(width - PDF_PAGE.margin, y)
    .strokeColor(PDF_COLOR.lineStrong).lineWidth(0.8).stroke();
  doc.font(PDF_FONT.regular).fontSize(7.5).fillColor(PDF_COLOR.inkFaint);
  doc.text(
    `${PDF_BRAND.name}  ·  ${PDF_BRAND.tagline}`,
    PDF_PAGE.margin,
    y + 8,
    { width: 240, lineBreak: false },
  );
  doc.text(
    footerNote,
    PDF_PAGE.margin + 240,
    y + 8,
    { width: width - PDF_PAGE.margin * 2 - 240, align: 'right', lineBreak: false },
  );
  doc.restore();
}

export function drawPdfFirstHeader(
  doc: PDFKit.PDFDocument,
  title: string,
  rightLabel = 'Original for Recipient',
) {
  const { width } = doc.page;
  doc.save();
  doc.rect(0, 0, width, PDF_PAGE.headerH).fill(PDF_COLOR.ink);
  doc.rect(0, PDF_PAGE.headerH, width, PDF_PAGE.goldH).fill(PDF_COLOR.brand);
  doc.font(PDF_FONT.bold).fontSize(10).fillColor(PDF_COLOR.brand);
  doc.text(PDF_BRAND.name.toUpperCase(), PDF_PAGE.margin, 14, {
    width: 280,
    characterSpacing: 1.4,
    lineBreak: false,
  });
  doc.font(PDF_FONT.regular).fontSize(8).fillColor(PDF_COLOR.inkFaint);
  doc.text(rightLabel, width - PDF_PAGE.margin - 160, 16, {
    width: 160,
    align: 'right',
    lineBreak: false,
  });
  doc.font(PDF_FONT.bold).fontSize(18).fillColor(PDF_COLOR.white);
  doc.text(title, PDF_PAGE.margin, 36, { width: width - PDF_PAGE.margin * 2, lineBreak: false });
  doc.restore();
}

export function drawPdfContinuedHeader(
  doc: PDFKit.PDFDocument,
  title: string,
  continuationLabel = 'Continued',
) {
  const { width } = doc.page;
  doc.save();
  doc.rect(0, 0, width, 36).fill(PDF_COLOR.ink);
  doc.rect(0, 36, width, 2).fill(PDF_COLOR.brand);
  doc.font(PDF_FONT.bold).fontSize(9).fillColor(PDF_COLOR.brand);
  doc.text(PDF_BRAND.name.toUpperCase(), PDF_PAGE.margin, 12, {
    width: 160,
    characterSpacing: 1.2,
    lineBreak: false,
  });
  doc.font(PDF_FONT.regular).fontSize(9).fillColor(PDF_COLOR.white);
  doc.text(title, PDF_PAGE.margin + 170, 12, {
    width: width - PDF_PAGE.margin * 2 - 250,
    lineBreak: false,
    ellipsis: true,
  });
  doc.fillColor(PDF_COLOR.inkFaint);
  doc.text(continuationLabel, width - PDF_PAGE.margin - 80, 12, {
    width: 80,
    align: 'right',
    lineBreak: false,
  });
  doc.restore();
}
