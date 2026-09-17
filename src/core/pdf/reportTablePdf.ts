import { createBrandedPdfDocument, finalizePdfDocument } from './pdfDocument';
import { formatPdfCellValue } from './pdfFormatters';
import { PdfPageLayout } from './pdfPageLayout';
import {
  buildMeasuredColumns,
  type PdfColumnSpec,
} from './pdfText';
import {
  drawContinuationLabel,
  drawTableHeader,
  drawTableRow,
  measureTableRowHeight,
} from './pdfTable';

export type ReportPdfColumn = {
  key: string;
  label: string;
  align?: 'left' | 'right';
  minWidth?: number;
  maxWidth?: number;
};

export type ReportTablePdfInput = {
  title: string;
  subtitle?: string;
  columns: ReportPdfColumn[];
  rows: Record<string, unknown>[];
  emptyMessage?: string;
};

function isNumericColumn(values: string[]): boolean {
  if (values.length === 0) return false;
  return values.every((v) => /^-?\d[\d,]*(\.\d+)?$/.test(v) || v === '--');
}

export async function renderReportTablePdf(input: ReportTablePdfInput): Promise<Buffer> {
  const doc = createBrandedPdfDocument({
    title: input.title,
    subject: input.subtitle ?? input.title,
  });

  const layout = new PdfPageLayout(doc, input.title, input.subtitle ?? input.title);
  layout.startPage(true);

  if (input.subtitle) {
    layout.doc.font('Helvetica').fontSize(9).fillColor('#5C5750');
    layout.doc.text(input.subtitle, layout.margin, layout.y, {
      width: layout.contentWidth,
      lineBreak: false,
      ellipsis: true,
    });
    layout.y += 16;
  }

  if (input.rows.length === 0) {
    layout.doc.font('Helvetica').fontSize(10).fillColor('#1B1917');
    layout.doc.text(input.emptyMessage ?? 'No rows', layout.margin, layout.y);
    return finalizePdfDocument(doc);
  }

  const formattedRows = input.rows.map((row) => {
    const out: Record<string, string> = {};
    for (const col of input.columns) {
      out[col.key] = formatPdfCellValue(row[col.key]);
    }
    return out;
  });

  const specs: PdfColumnSpec[] = input.columns.map((col) => {
    const values = formattedRows.map((row) => row[col.key] ?? '--');
    const numeric = isNumericColumn(values);
    return {
      key: col.key,
      label: col.label,
      values,
      minWidth: col.minWidth ?? (numeric ? 40 : 56),
      maxWidth: col.maxWidth ?? (numeric ? 90 : 140),
      align: col.align ?? (numeric ? 'right' : 'left'),
    };
  });

  const primaryKey = input.columns[0]?.key ?? 'col0';
  const cols = buildMeasuredColumns(
    layout.doc,
    layout.contentWidth,
    specs,
    primaryKey,
    96,
  );

  const tableHeaderH = 16;
  const rowGap = 0;
  const sectionGap = 8;
  const continuationPrefix = 'Table';

  const paintTableHeader = () => {
    drawTableHeader(
      layout.doc,
      layout.margin,
      layout.y,
      layout.contentWidth,
      cols,
    );
    layout.y += tableHeaderH;
  };

  layout.ensure(tableHeaderH + 20);
  paintTableHeader();

  for (let index = 0; index < formattedRows.length; index += 1) {
    const values = formattedRows[index]!;
    const rowH = measureTableRowHeight(layout.doc, cols, {
      title: values[primaryKey] ?? '',
    });

    if (layout.y + rowH + rowGap > layout.pageBottomY) {
      layout.addPage();
      layout.y += drawContinuationLabel(
        layout.doc,
        layout.margin,
        layout.y,
        layout.contentWidth,
        `${continuationPrefix}  ·  ${input.title}`,
      );
      paintTableHeader();
    }

    drawTableRow(
      layout.doc,
      layout.margin,
      layout.y,
      layout.contentWidth,
      rowH,
      cols,
      values,
      index,
      { title: values[primaryKey] ?? '' },
    );
    layout.y += rowH + rowGap;
  }

  layout.y += sectionGap;
  return finalizePdfDocument(doc);
}
