import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { pageLimitQuerySchema } from '@core/http/pagination';
import { commissionsService } from './commissions.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = pageLimitQuerySchema.parse(req.query);
  const result = await commissionsService.list(query, req.user!.vendorId);
  res.json(ok(result.commissions, { pagination: result.pagination }));
});

export const listByVendor = asyncHandler(async (req: Request, res: Response) => {
  const vendorId = req.user!.vendorId ?? req.params.vendorId!;
  const rows = await commissionsService.listByVendor(vendorId);
  res.json(ok(rows));
});
