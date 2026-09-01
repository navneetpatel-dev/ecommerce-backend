import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { documentKeyToPdfTitle } from '@core/export/exportFilenames';
import { resolveReportColumnLabel } from '../../reports.constants';
import {
  contentTypeForFormat,
  type ReportExportFormat,
} from '../csvExporter';
import type { ReportColumn } from '../types';
import { ChunkedPdfWriter } from './ChunkedPdfWriter';
import type { StreamingExportArtifact, StreamingExportWriter } from './exportWriterTypes';

export type { StreamingExportArtifact, StreamingExportWriter } from './exportWriterTypes';

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

class StreamingCsvWriter implements StreamingExportWriter {
  private stream: fs.WriteStream;
  private headerWritten = false;

  constructor(
    readonly tempPath: string,
    private readonly columns: ReportColumn[],
  ) {
    this.stream = fs.createWriteStream(tempPath, { encoding: 'utf8' });
  }

  async writeHeader(): Promise<void> {
    if (this.headerWritten) return;
    const headers = this.columns.map((col) => resolveReportColumnLabel(col.labelKey));
    const escape = (value: string) => {
      if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
      return value;
    };
    await new Promise<void>((resolve, reject) => {
      this.stream.write(`${headers.map(escape).join(',')}\n`, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    this.headerWritten = true;
  }

  async writeRows(rows: Record<string, unknown>[]): Promise<void> {
    if (!this.headerWritten) await this.writeHeader();
    const escape = (value: string) => {
      if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
      return value;
    };
    const lines = rows.map((row) =>
      this.columns
        .map((col) => escape(formatCsvCell(row[col.key], col.format)))
        .join(','),
    );
    if (lines.length === 0) return;
    await new Promise<void>((resolve, reject) => {
      this.stream.write(`${lines.join('\n')}\n`, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async finalize(): Promise<StreamingExportArtifact> {
    await new Promise<void>((resolve, reject) => {
      this.stream.end((err: Error | null | undefined) => {
        if (err) reject(err);
        else resolve();
      });
    });
    const stat = await fsp.stat(this.tempPath);
    return {
      tempPath: this.tempPath,
      contentType: contentTypeForFormat('csv'),
      byteSize: stat.size,
    };
  }

  async dispose(): Promise<void> {
    await fsp.unlink(this.tempPath).catch(() => undefined);
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

class StreamingXlsxWriter implements StreamingExportWriter {
  private workbook: ExcelJS.stream.xlsx.WorkbookWriter;
  private sheet: ExcelJS.Worksheet;
  private finalized = false;

  constructor(
    readonly tempPath: string,
    private readonly columns: ReportColumn[],
    sheetName: string,
  ) {
    this.workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: tempPath,
      useStyles: true,
    });
    this.workbook.creator = 'ecommerce-reports';
    this.sheet = this.workbook.addWorksheet(sheetName.slice(0, 31));
    this.sheet.columns = columns.map((col) => {
      const header = resolveReportColumnLabel(col.labelKey);
      return {
        header,
        key: col.key,
        width: Math.min(40, Math.max(12, header.length + 4)),
      };
    });
  }

  async writeHeader(): Promise<void> {
    const header = this.sheet.getRow(1);
    header.font = { bold: true };
    header.commit();
  }

  async writeRows(rows: Record<string, unknown>[]): Promise<void> {
    for (const row of rows) {
      const values: Record<string, unknown> = {};
      for (const col of this.columns) {
        values[col.key] = formatExcelCell(row[col.key], col.format);
      }
      const excelRow = this.sheet.addRow(values);
      this.columns.forEach((col, idx) => {
        const cell = excelRow.getCell(idx + 1);
        if (col.format === 'currency') cell.numFmt = '₹#,##0.00';
        else if (col.format === 'percent') cell.numFmt = '0.00';
        else if (col.format === 'date' && cell.value instanceof Date) {
          cell.numFmt = 'yyyy-mm-dd hh:mm';
        }
      });
      excelRow.commit();
    }
  }

  async finalize(): Promise<StreamingExportArtifact> {
    if (!this.finalized) {
      await this.sheet.commit();
      await this.workbook.commit();
      this.finalized = true;
    }
    const stat = await fsp.stat(this.tempPath);
    return {
      tempPath: this.tempPath,
      contentType: contentTypeForFormat('xlsx'),
      byteSize: stat.size,
    };
  }

  async dispose(): Promise<void> {
    await fsp.unlink(this.tempPath).catch(() => undefined);
  }
}

export function createStreamingWriter(
  format: ReportExportFormat,
  columns: ReportColumn[],
  reportType: string,
): StreamingExportWriter {
  const tempPath = path.join(
    os.tmpdir(),
    `report-export-${randomUUID()}.${format === 'csv' ? 'csv' : format === 'pdf' ? 'pdf' : 'xlsx'}`,
  );
  if (format === 'csv') return new StreamingCsvWriter(tempPath, columns);
  if (format === 'pdf') {
    return new ChunkedPdfWriter(tempPath, columns, documentKeyToPdfTitle(reportType));
  }
  return new StreamingXlsxWriter(tempPath, columns, reportType);
}
