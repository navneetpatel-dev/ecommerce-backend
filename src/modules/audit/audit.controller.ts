import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import type { ListAuditQuery } from './audit.dto';
import { listAudit } from './audit.service';

export const listAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, entityType, actorId, actor, from, to } = req.query as unknown as ListAuditQuery;
  const result = await listAudit({ page, limit }, { entityType, actorId, actor, from, to });
  res.json(ok(result.logs, { pagination: result.pagination }));
});
