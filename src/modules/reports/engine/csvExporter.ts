import { resolveReportColumnLabel } from '../reports.constants';
import type { ReportColumn } from './types';

function formatCell(value: unknown, format?: string): string {
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

export function buildCsvBuffer(
  columns: ReportColumn[],
  rows: Record<string, unknown>[],
): Buffer {
  const headers = columns.map((col) => resolveReportColumnLabel(col.labelKey));
  const escape = (value: string) => {
    if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
    return value;
  };
  const lines = [
    headers.map(escape).join(','),
    ...rows.map((row) =>
      columns
        .map((col) => escape(formatCell(row[col.key], col.format)))
        .join(','),
    ),
  ];
  return Buffer.from(lines.join('\n'), 'utf8');
}

export type ReportExportFormat = 'xlsx' | 'csv' | 'pdf';

export function contentTypeForFormat(format: ReportExportFormat): string {
  if (format === 'csv') return 'text/csv; charset=utf-8';
  if (format === 'pdf') return 'application/pdf';
  return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}

export function extensionForFormat(format: ReportExportFormat): string {
  if (format === 'csv') return 'csv';
  if (format === 'pdf') return 'pdf';
  return 'xlsx';
}
