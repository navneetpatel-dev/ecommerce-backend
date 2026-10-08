import { z } from 'zod';
import { inclusiveReportFrom, inclusiveReportTo } from '@modules/reports/engine/queryHelpers';

/** Query for GET /admin/analytics/export (platform analytics export). */
export const AnalyticsExportSchema = z.object({
  from: z.coerce
    .date()
    .optional()
    .transform((value) => (value ? inclusiveReportFrom(value) : undefined)),
  to: z.coerce
    .date()
    .optional()
    .transform((value) => (value ? inclusiveReportTo(value) : undefined)),
  format: z.enum(['xlsx', 'csv', 'pdf']).default('xlsx'),
});
