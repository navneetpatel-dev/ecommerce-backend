import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { pageLimitQuerySchema } from '@core/http/pagination';
import { listAudit } from './audit.service';

export const listAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const query = pageLimitQuerySchema.parse(req.query);
  const entityType = typeof req.query.entityType === 'string' ? req.query.entityType : undefined;
  const result = await listAudit(query, entityType);
  res.json(ok(result.logs, { pagination: result.pagination }));
});
