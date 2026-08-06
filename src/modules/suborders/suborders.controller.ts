import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { subordersService } from './suborders.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const items = await subordersService.list(req.user!.vendorId);
  res.json(ok(items, { pagination: { total: items.length, page: 1, limit: items.length || 20, totalPages: 1 } }));
});

export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const updated = await subordersService.updateStatus(req.params.id!, req.body.status, req.body.trackingId, req.user!.id);
  res.json(ok(updated));
});
