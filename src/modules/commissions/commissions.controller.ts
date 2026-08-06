import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { commissionsService } from './commissions.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const rows = await commissionsService.list(req.user!.vendorId);
  res.json(ok(rows));
});

export const listByVendor = asyncHandler(async (req: Request, res: Response) => {
  const vendorId = req.user!.vendorId ?? req.params.vendorId!;
  const rows = await commissionsService.listByVendor(vendorId);
  res.json(ok(rows));
});
