import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { pageLimitQuerySchema } from '@core/http/pagination';
import { payoutsService } from './payouts.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = pageLimitQuerySchema.parse(req.query);
  const result = await payoutsService.list(query, req.user!.vendorId);
  res.json(ok(result.payouts, { pagination: result.pagination }));
});

export const process = asyncHandler(async (req: Request, res: Response) => {
  const payouts = await payoutsService.process(req.user!.id);
  res.status(201).json(ok(payouts));
});

export const listByVendor = asyncHandler(async (req: Request, res: Response) => {
  const rows = await payoutsService.listByVendor(req.params.vendorId!, req.user!.vendorId);
  res.json(ok(rows));
});
