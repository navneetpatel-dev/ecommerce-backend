import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { listAudit } from './audit.service';

export const listAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const entityType =
    typeof req.query.entityType === 'string' ? req.query.entityType : undefined;
  res.json(ok(await listAudit(entityType)));
});
