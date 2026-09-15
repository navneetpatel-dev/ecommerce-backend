import ExcelJS from 'exceljs';
import type { ExportColumn, ExportArtifact, ExportWriter } from '../exportTypes';
import { contentTypeForExportFormat } from '../exportTypes';

function formatCsvCell(value: unknown, format?: string): string {
  if (value == null) return '';
  if (format === 'date') {
    const d = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
  }
  if (format === 'currency' || format === 'number' || format === 'percent') {
    const n = Number(value);
    return Number.isFinite(n) ? String(n) : '0';
  }
  if (format === 'points') {
    const n = Number(value);
    return Number.isFinite(n) ? `${n} pts` : '0 pts';
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

class StreamingCsvWriter implements ExportWriter {
  private headerWritten = false;
  private bytesWritten = 0;

  constructor(private readonly sink: NodeJS.WritableStream, private readonly columns: ExportColumn[]) {}

  private write(text: string): Promise<void> {
    this.bytesWritten += Buffer.byteLength(text, 'utf8');
    return new Promise((resolve, reject) => {
      this.sink.write(text, (err) => (err ? reject(err) : resolve()));
    });
  }

  async writeHeader(): Promise<void> {
    if (this.headerWritten) return;
    const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
    await this.write(`${this.columns.map((c) => escape(c.label)).join(',')}\n`);
    this.headerWritten = true;
  }

  async writeRows(rows: Record<string, unknown>[]): Promise<void> {
    if (!this.headerWritten) await this.writeHeader();
    const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
    const lines = rows.map((row) =>
      this.columns.map((col) => escape(formatCsvCell(row[col.key], col.format))).join(','),
    );
    if (lines.length === 0) return;
    await this.write(`${lines.join('\n')}\n`);
  }

  async finalize(): Promise<ExportArtifact> {
    await new Promise<void>((resolve, reject) => {
      this.sink.once('error', reject);
      this.sink.end(() => resolve());
    });
    return { contentType: contentTypeForExportFormat('csv'), byteSize: this.bytesWritten };
  }

  async dispose(): Promise<void> {
    if ('destroy' in this.sink) (this.sink as { destroy: () => void }).destroy();
  }
}

function formatExcelCell(value: unknown, format?: string): string | number | Date {
  if (value == null) return '';
  if (format === 'date') {
    const d = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(d.getTime()) ? String(value) : d;
  }
  if (format === 'currency' || format === 'number' || format === 'percent') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

class StreamingXlsxWriter implements ExportWriter {
  private workbook: ExcelJS.stream.xlsx.WorkbookWriter;
  private sheet: ExcelJS.Worksheet;
  private finalized = false;

  constructor(private readonly sink: NodeJS.WritableStream, private readonly columns: ExportColumn[], sheetName: string) {
    // ExcelJS's streaming WorkbookWriter accepts a `stream` target as an
    // alternative to `filename` — this is the one line that actually makes
    // XLSX pipe-able instead of file-based; everything else is unchanged.
    this.workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: sink as any, useStyles: true });
    this.workbook.creator = 'ecommerce-exports';
    this.sheet = this.workbook.addWorksheet(sheetName.slice(0, 31));
    this.sheet.columns = columns.map((col) => ({
      header: col.label,
      key: col.key,
      width: Math.min(40, Math.max(12, col.label.length + 4)),
    }));
  }

  async writeHeader(): Promise<void> {
    const header = this.sheet.getRow(1);
    header.font = { bold: true };
    header.commit();
  }

  async writeRows(rows: Record<string, unknown>[]): Promise<void> {
    for (const row of rows) {
      const values: Record<string, unknown> = {};
      for (const col of this.columns) values[col.key] = formatExcelCell(row[col.key], col.format);
      const excelRow = this.sheet.addRow(values);
      this.columns.forEach((col, idx) => {
        const cell = excelRow.getCell(idx + 1);
        if (col.format === 'currency') cell.numFmt = '₹#,##0.00';
        else if (col.format === 'percent') cell.numFmt = '0.00';
        else if (col.format === 'date' && cell.value instanceof Date) cell.numFmt = 'yyyy-mm-dd hh:mm';
      });
      excelRow.commit();
    }
  }

  async finalize(): Promise<ExportArtifact> {
    if (!this.finalized) {
      await this.sheet.commit();
      await this.workbook.commit();
      this.finalized = true;
    }
    const byteSize = (this.sink as unknown as { bytesWritten?: number }).bytesWritten ?? 0;
    return { contentType: contentTypeForExportFormat('xlsx'), byteSize };
  }

  async dispose(): Promise<void> {
    if ('destroy' in this.sink) (this.sink as { destroy: () => void }).destroy();
  }
}

export function createCsvOrXlsxWriter(
  format: 'csv' | 'xlsx',
  columns: ExportColumn[],
  sheetName: string,
  sink: NodeJS.WritableStream,
): ExportWriter {
  return format === 'csv'
    ? new StreamingCsvWriter(sink, columns)
    : new StreamingXlsxWriter(sink, columns, sheetName);
}
