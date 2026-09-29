import { z } from 'zod';
import { inclusiveReportFrom, inclusiveReportTo } from '@modules/reports/engine/queryHelpers';

export const WalletStatementSchema = z.object({
  from: z.coerce.date().transform(inclusiveReportFrom),
  to: z.coerce.date().transform(inclusiveReportTo),
  format: z.enum(['xlsx', 'csv', 'pdf']).default('xlsx'),
});

export type WalletStatementQuery = z.infer<typeof WalletStatementSchema>;
