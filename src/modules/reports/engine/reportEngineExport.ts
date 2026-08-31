import { renderReportTablePdf } from '@core/pdf';
import { documentKeyToPdfTitle } from '@core/export/exportFilenames';
import { resolveReportColumnLabel } from '../reports.constants';
import { buildExcelBuffer } from './excelExporter';
import { buildCsvBuffer, type ReportExportFormat } from './csvExporter';
import type { ReportColumn } from './types';

export async function buildExportBuffer(
  format: ReportExportFormat,
  columns: ReportColumn[],
  rows: Record<string, unknown>[],
  reportType: string,
): Promise<Buffer> {
  if (format === 'csv') return buildCsvBuffer(columns, rows);
  if (format === 'pdf') {
    return renderReportTablePdf({
      title: documentKeyToPdfTitle(reportType),
      columns: columns.map((col) => ({
        key: col.key,
        label: resolveReportColumnLabel(col.labelKey),
      })),
      rows,
      emptyMessage: 'No rows',
    });
  }
  return buildExcelBuffer(columns, rows, reportType);
}

export type { ReportExportFormat };
