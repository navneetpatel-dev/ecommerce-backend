import { z } from 'zod';
import { inclusiveReportTo } from '@modules/reports/engine/queryHelpers';

export const WalletStatementSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date().transform(inclusiveReportTo),
  format: z.enum(['xlsx', 'csv', 'pdf']).default('xlsx'),
});

export type WalletStatementQuery = z.infer<typeof WalletStatementSchema>;
