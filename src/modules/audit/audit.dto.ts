import { z } from 'zod';
import { pageLimitQuerySchema } from '@core/http/pagination';
import { inclusiveReportFrom, inclusiveReportTo } from '@modules/reports/engine/queryHelpers';

export const ListAuditQuerySchema = pageLimitQuerySchema.extend({
  entityType: z.string().trim().min(1).optional(),
  actorId: z.string().uuid().optional(),
  actor: z.string().trim().min(1).optional(),
  vendorId: z.string().uuid().optional(),
  from: z.coerce.date().transform(inclusiveReportFrom).optional(),
  to: z.coerce.date().transform((value) => (value ? inclusiveReportTo(value) : value)).optional(),
});

export type ListAuditQuery = z.infer<typeof ListAuditQuerySchema>;
