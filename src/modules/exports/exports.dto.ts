import { z } from 'zod';

export const CreateExportJobSchema = z.object({
  domain: z.string().min(1).max(40),
  exportType: z.string().min(1).max(80),
  format: z.enum(['csv', 'xlsx', 'pdf']),
  filters: z.record(z.unknown()).default({}),
});

export type CreateExportJobInput = z.infer<typeof CreateExportJobSchema>;
