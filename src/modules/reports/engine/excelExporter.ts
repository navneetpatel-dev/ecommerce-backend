import ExcelJS from 'exceljs';
import { resolveReportColumnLabel } from '../reports.constants';
import type { ReportColumn } from './types';

function formatCell(value: unknown, format?: string): string | number | Date {
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

export function buildReportFilename(reportType: string, from: Date, to: Date): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fromS = from.toISOString().slice(0, 10);
  const toS = to.toISOString().slice(0, 10);
  return `${reportType}_${fromS}_${toS}_${stamp}.xlsx`;
}

export async function buildExcelBuffer(
  columns: ReportColumn[],
  rows: Record<string, unknown>[],
  sheetName = 'Report',
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ecommerce-reports';
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31));

  sheet.columns = columns.map((col) => {
    const header = resolveReportColumnLabel(col.labelKey);
    return {
      header,
      key: col.key,
      width: Math.min(40, Math.max(12, header.length + 4)),
    };
  });

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: 'middle' };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const row of rows) {
    const values: Record<string, unknown> = {};
    for (const col of columns) {
      values[col.key] = formatCell(row[col.key], col.format);
    }
    const excelRow = sheet.addRow(values);
    columns.forEach((col, idx) => {
      const cell = excelRow.getCell(idx + 1);
      if (col.format === 'currency') {
        cell.numFmt = '₹#,##0.00';
      } else if (col.format === 'percent') {
        cell.numFmt = '0.00';
      } else if (col.format === 'date' && cell.value instanceof Date) {
        cell.numFmt = 'yyyy-mm-dd hh:mm';
      }
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
