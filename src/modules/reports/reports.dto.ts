import { z } from 'zod';
import { pageLimitQuerySchema } from '@core/http/pagination';
import { inclusiveReportTo } from './engine/queryHelpers';

export const ReportRangeSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date().transform(inclusiveReportTo),
  format: z.enum(['json', 'xlsx', 'csv', 'pdf']).default('json'),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const WriteOffReportSchema = ReportRangeSchema.extend({
  bornBy: z.enum(['PLATFORM', 'VENDOR']).optional(),
});

export const EngineReportQuerySchema = pageLimitQuerySchema.extend({
  from: z.coerce.date(),
  to: z.coerce.date().transform(inclusiveReportTo),
  format: z.enum(['json', 'xlsx', 'csv', 'pdf']).default('json'),
  vendorId: z.string().uuid().optional().nullable(),
  categoryId: z.string().uuid().optional().nullable(),
  status: z.string().optional().nullable(),
  bornBy: z.enum(['PLATFORM', 'VENDOR']).optional().nullable(),
});

export const CustomerOrderHistorySchema = pageLimitQuerySchema.extend({
  from: z.coerce.date(),
  to: z.coerce.date().transform(inclusiveReportTo),
  format: z.enum(['json', 'xlsx', 'csv', 'pdf']).default('json'),
});

export type ReportRangeQuery = z.infer<typeof ReportRangeSchema>;
export type WriteOffReportQuery = z.infer<typeof WriteOffReportSchema>;
export type EngineReportQuery = z.infer<typeof EngineReportQuerySchema>;
