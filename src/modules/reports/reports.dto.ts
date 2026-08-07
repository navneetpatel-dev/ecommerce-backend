import { z } from 'zod';

export const ReportRangeSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  format: z.enum(['json', 'csv', 'pdf']).default('json'),
});

export type ReportRangeQuery = z.infer<typeof ReportRangeSchema>;
