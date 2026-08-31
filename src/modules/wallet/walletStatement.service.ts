import { z } from 'zod';
import { inclusiveReportTo } from '@modules/reports/engine/queryHelpers';
import { reportEngine, type ReportActor } from '@modules/reports/engine/reportEngine';
import type { ReportExportFormat } from '@modules/reports/engine/csvExporter';
import type { AsyncExportResult } from '@modules/reports/engine/reportEngine';

const WalletStatementSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date().transform(inclusiveReportTo),
  format: z.enum(['xlsx', 'csv', 'pdf']).default('xlsx'),
});

export async function exportWalletStatement(input: {
  actor: ReportActor;
  from: Date;
  to: Date;
  format: ReportExportFormat;
}): Promise<AsyncExportResult> {
  return reportEngine.runExport(
    input.actor,
    'customer-wallet-statement',
    {
      from: input.from,
      to: input.to,
      userId: input.actor.id,
    },
    input.format,
  );
}

export { WalletStatementSchema };
