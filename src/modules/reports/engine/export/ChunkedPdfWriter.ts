import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createBrandedPdfDocument, pipePdfDocument } from '@core/pdf';
import { formatPdfCellValue } from '@core/pdf/pdfFormatters';
import { PdfPageLayout } from '@core/pdf/pdfPageLayout';
import {
  buildMeasuredColumns,
  type PdfColumnSpec,
} from '@core/pdf/pdfText';
import {
  drawContinuationLabel,
  drawTableHeader,
  drawTableRow,
  measureTableRowHeight,
} from '@core/pdf/pdfTable';
import { resolveReportColumnLabel } from '../../reports.constants';
import { reportExportConfig } from '../../reportExportConfig';
import { contentTypeForFormat } from '../csvExporter';
import type { ReportColumn } from '../types';
import type { StreamingExportArtifact, StreamingExportWriter } from './exportWriterTypes';

function isNumericColumn(values: string[]): boolean {
  if (values.length === 0) return false;
  return values.every((v) => /^-?\d[\d,]*(\.\d+)?$/.test(v) || v === '--');
}

/** Incremental PDF table writer — pipes PDFKit to a temp file as pages are drawn. */
export class ChunkedPdfWriter implements StreamingExportWriter {
  private doc: PDFKit.PDFDocument;
  private layout: PdfPageLayout;
  private stream: fs.WriteStream;
  private cols: ReturnType<typeof buildMeasuredColumns> | null = null;
  private primaryKey: string;
  private rowIndex = 0;
  private started = false;
  private finalized = false;
  private sampleBuffer: Record<string, string>[] = [];
  private readonly sampleTarget = 500;
  private pendingRows: Record<string, unknown>[] = [];

  constructor(
    readonly tempPath: string,
    private readonly columns: ReportColumn[],
    private readonly title: string,
  ) {
    this.primaryKey = columns[0]?.key ?? 'col0';
    this.doc = createBrandedPdfDocument({ title: this.title });
    this.stream = fs.createWriteStream(tempPath);
    this.doc.pipe(this.stream);
    this.layout = new PdfPageLayout(this.doc, this.title, this.title);
  }

  async writeHeader(): Promise<void> {
    if (this.started) return;
    this.layout.startPage(true);
    this.started = true;
  }

  async writeRows(rows: Record<string, unknown>[]): Promise<void> {
    if (!this.started) await this.writeHeader();
    if (rows.length === 0) return;

    const pdfColumns = this.columns.map((col) => ({
      key: col.key,
      label: resolveReportColumnLabel(col.labelKey),
    }));

    if (!this.cols) {
      this.pendingRows.push(...rows);
      for (const row of rows) {
        if (this.sampleBuffer.length >= this.sampleTarget) break;
        const out: Record<string, string> = {};
        for (const col of pdfColumns) {
          out[col.key] = formatPdfCellValue(row[col.key]);
        }
        this.sampleBuffer.push(out);
      }
      const lastChunk = rows.length < reportExportConfig.chunkSize;
      if (this.sampleBuffer.length < this.sampleTarget && !lastChunk) {
        return;
      }
      this.ensureColumns(pdfColumns);
      for (const pending of this.pendingRows) {
        this.drawRow(pdfColumns, pending);
      }
      this.pendingRows = [];
      return;
    }

    for (const row of rows) {
      this.drawRow(pdfColumns, row);
    }
  }

  private ensureColumns(pdfColumns: Array<{ key: string; label: string }>) {
    if (this.cols) return;
    const sample = this.sampleBuffer.slice(0, this.sampleTarget);
    const specs: PdfColumnSpec[] = pdfColumns.map((col) => {
      const values = sample.map((row) => row[col.key] ?? '--');
      const numeric = isNumericColumn(values);
      return {
        key: col.key,
        label: col.label,
        values,
        minWidth: numeric ? 40 : 56,
        maxWidth: numeric ? 90 : 140,
        align: numeric ? ('right' as const) : ('left' as const),
      };
    });
    this.cols = buildMeasuredColumns(
      this.layout.doc,
      this.layout.contentWidth,
      specs,
      this.primaryKey,
      96,
    );
    this.paintTableHeader();
  }

  private drawRow(
    pdfColumns: Array<{ key: string; label: string }>,
    row: Record<string, unknown>,
  ) {
    const values: Record<string, string> = {};
    for (const col of pdfColumns) {
      values[col.key] = formatPdfCellValue(row[col.key]);
    }
    const rowGap = 0;
    const continuationPrefix = 'Table';
    const rowH = measureTableRowHeight(this.layout.doc, this.cols!, {
      title: values[this.primaryKey] ?? '',
    });
    const available = this.layout.pageBottomY - this.layout.y;
    const effectiveRowH = Math.min(rowH, Math.max(20, available - 8));

    let pageGuard = 0;
    while (this.layout.y + effectiveRowH + rowGap > this.layout.pageBottomY) {
      if (pageGuard >= 50) {
        throw new Error('PDF export exceeded maximum page count for a single row');
      }
      pageGuard += 1;
      this.layout.addPage();
      this.layout.y += drawContinuationLabel(
        this.layout.doc,
        this.layout.margin,
        this.layout.y,
        this.layout.contentWidth,
        `${continuationPrefix}  ·  ${this.title}`,
      );
      this.paintTableHeader();
    }

    drawTableRow(
      this.layout.doc,
      this.layout.margin,
      this.layout.y,
      this.layout.contentWidth,
      effectiveRowH,
      this.cols!,
      values,
      this.rowIndex,
      { title: values[this.primaryKey] ?? '' },
    );
    this.layout.y += effectiveRowH + rowGap;
    this.rowIndex += 1;
  }

  private paintTableHeader() {
    const tableHeaderH = 16;
    this.layout.ensure(tableHeaderH + 20);
    drawTableHeader(
      this.layout.doc,
      this.layout.margin,
      this.layout.y,
      this.layout.contentWidth,
      this.cols!,
    );
    this.layout.y += tableHeaderH;
  }

  async finalize(): Promise<StreamingExportArtifact> {
    if (this.finalized) {
      const stat = await fsp.stat(this.tempPath);
      return {
        tempPath: this.tempPath,
        contentType: contentTypeForFormat('pdf'),
        byteSize: stat.size,
      };
    }
    if (!this.started) await this.writeHeader();
    if (!this.cols && this.pendingRows.length > 0) {
      const pdfColumns = this.columns.map((col) => ({
        key: col.key,
        label: resolveReportColumnLabel(col.labelKey),
      }));
      this.ensureColumns(pdfColumns);
      for (const pending of this.pendingRows) {
        this.drawRow(pdfColumns, pending);
      }
      this.pendingRows = [];
    }
    if (this.rowIndex === 0) {
      this.layout.doc.font('Helvetica').fontSize(10).fillColor('#1B1917');
      this.layout.doc.text('No rows', this.layout.margin, this.layout.y);
    }
    await pipePdfDocument(this.doc, this.stream);
    this.finalized = true;
    const stat = await fsp.stat(this.tempPath);
    return {
      tempPath: this.tempPath,
      contentType: contentTypeForFormat('pdf'),
      byteSize: stat.size,
    };
  }

  async dispose(): Promise<void> {
    await fsp.unlink(this.tempPath).catch(() => undefined);
  }
}
