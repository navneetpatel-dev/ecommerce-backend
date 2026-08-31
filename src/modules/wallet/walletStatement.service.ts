import { z } from 'zod';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { getReportDefinition } from '@modules/reports/engine/reportRegistry';
import {
  normalizeReportFilters,
  assertReportRange,
  inclusiveReportTo,
} from '@modules/reports/engine/queryHelpers';
import { buildExportBuffer } from '@modules/reports/engine/reportEngineExport';
import { buildReportFilename } from '@modules/reports/engine/excelExporter';
import type { ReportExportFormat } from '@modules/reports/engine/csvExporter';

const WalletStatementSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date().transform(inclusiveReportTo),
  format: z.enum(['xlsx', 'csv', 'pdf']).default('xlsx'),
});

export async function exportWalletStatement(input: {
  userId: string;
  from: Date;
  to: Date;
  format: ReportExportFormat;
}): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
  const def = getReportDefinition('customer-wallet-statement');
  if (!def) throw new ValidationError(ERROR_MESSAGES.REPORT_NOT_FOUND);
  assertReportRange({ from: input.from, to: input.to } as any);
  const filters = normalizeReportFilters({
    from: input.from,
    to: input.to,
    userId: input.userId,
    page: 1,
    limit: 10_000,
  });
  const result = await def.query(filters);
  const buffer = await buildExportBuffer(
    input.format,
    def.columns,
    result.rows,
    def.type,
  );
  const filename = buildReportFilename(def.type, filters.from, filters.to, input.format);
  const contentType =
    input.format === 'csv'
      ? 'text/csv; charset=utf-8'
      : input.format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return { buffer, filename, contentType };
}

export { WalletStatementSchema };
