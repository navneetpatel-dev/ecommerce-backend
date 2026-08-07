import { z } from 'zod';

export const ReportRangeSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  format: z.enum(['json', 'csv', 'pdf']).default('json'),
});

export const WriteOffReportSchema = ReportRangeSchema.extend({
  bornBy: z.enum(['PLATFORM', 'VENDOR']).optional(),
});

export type ReportRangeQuery = z.infer<typeof ReportRangeSchema>;
export type WriteOffReportQuery = z.infer<typeof WriteOffReportSchema>;
