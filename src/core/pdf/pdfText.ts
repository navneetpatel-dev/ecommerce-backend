import {
  PDF_CELL_PAD,
  PDF_FONT,
  PDF_HDR_FONT_SIZE,
  PDF_NUM_FONT_SIZE,
} from './pdfTheme';

export type PdfColumnAlign = 'left' | 'right';

export type PdfColumn = {
  key: string;
  label: string;
  width: number;
  align: PdfColumnAlign;
};

export type PdfColumnSpec = {
  key: string;
  label: string;
  values: string[];
  minWidth: number;
  maxWidth: number;
  align: PdfColumnAlign;
};

type TextOpts = {
  bold?: boolean;
  size?: number;
  color?: string;
  align?: PdfColumnAlign;
  lineBreak?: boolean;
  ellipsis?: boolean;
};

export function measureColWidth(
  doc: PDFKit.PDFDocument,
  label: string,
  values: string[],
  minW: number,
  maxW: number,
  headerFontSize = PDF_HDR_FONT_SIZE,
  valueFontSize = PDF_NUM_FONT_SIZE,
): number {
  doc.font(PDF_FONT.bold).fontSize(headerFontSize);
  let w = doc.widthOfString(label.toUpperCase()) + PDF_CELL_PAD * 2;
  doc.font(PDF_FONT.regular).fontSize(valueFontSize);
  for (const value of values) {
    w = Math.max(w, doc.widthOfString(value) + PDF_CELL_PAD * 2);
  }
  return Math.min(maxW, Math.max(minW, Math.ceil(w)));
}

export function assertColumnsFit(contentWidth: number, cols: PdfColumn[]): void {
  const sum = cols.reduce((acc, col) => acc + col.width, 0);
  const delta = contentWidth - sum;
  if (Math.abs(delta) > 0.5) {
    const last = cols[cols.length - 1];
    if (last) last.width += delta;
  }
}

export function buildMeasuredColumns(
  doc: PDFKit.PDFDocument,
  contentWidth: number,
  specs: PdfColumnSpec[],
  primaryKey: string,
  minPrimaryWidth = 108,
): PdfColumn[] {
  const measured = specs.map((spec) => ({
    key: spec.key,
    label: spec.label,
    width: measureColWidth(doc, spec.label, spec.values, spec.minWidth, spec.maxWidth),
    align: spec.align,
  }));

  const primaryIdx = measured.findIndex((c) => c.key === primaryKey);
  const fixed = measured.reduce((sum, col) => sum + col.width, 0);
  let primaryW = contentWidth - fixed + (primaryIdx >= 0 ? measured[primaryIdx]!.width : 0);

  if (primaryIdx >= 0 && primaryW < minPrimaryWidth) {
    const deficit = minPrimaryWidth - primaryW;
    for (const col of measured) {
      if (col.key === primaryKey) continue;
      const spec = specs.find((s) => s.key === col.key);
      const minW = spec?.minWidth ?? 30;
      if (col.align === 'right' && col.width > minW) {
        col.width = Math.max(minW, col.width - Math.ceil(deficit / 2));
      }
    }
    const refixed = measured.reduce((sum, col) => sum + col.width, 0);
    primaryW = contentWidth - refixed + measured[primaryIdx]!.width;
    if (primaryW < minPrimaryWidth) {
      measured[primaryIdx]!.width = minPrimaryWidth;
    } else {
      measured[primaryIdx]!.width = primaryW;
    }
  } else if (primaryIdx >= 0) {
    measured[primaryIdx]!.width = primaryW;
  }

  assertColumnsFit(contentWidth, measured);
  return measured;
}

export function drawBoundedText(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  width: number,
  opts: TextOpts = {},
): number {
  const pad = PDF_CELL_PAD;
  const textW = width - pad * 2;
  doc.font(opts.bold ? PDF_FONT.bold : PDF_FONT.regular)
    .fontSize(opts.size ?? PDF_NUM_FONT_SIZE)
    .fillColor(opts.color ?? '#1B1917');
  const h = doc.heightOfString(text, {
    width: textW,
    lineBreak: opts.lineBreak ?? false,
  });
  doc.text(text, x + pad, y, {
    width: textW,
    align: opts.align ?? 'left',
    lineBreak: opts.lineBreak ?? false,
    ellipsis: opts.ellipsis ?? (opts.align !== 'right'),
  });
  return h;
}

export function measureTextHeight(
  doc: PDFKit.PDFDocument,
  text: string,
  width: number,
  opts: { bold?: boolean; size?: number; lineBreak?: boolean } = {},
): number {
  doc.font(opts.bold ? PDF_FONT.bold : PDF_FONT.regular).fontSize(opts.size ?? PDF_NUM_FONT_SIZE);
  return doc.heightOfString(text, {
    width: width - PDF_CELL_PAD * 2,
    lineBreak: opts.lineBreak ?? false,
  });
}
