import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { GetSubOrdersQuerySchema } from './suborders.dto';
import { subordersService } from './suborders.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = GetSubOrdersQuerySchema.parse(req.query);
  const result = await subordersService.list(req.user!.vendorId, query);
  res.json(ok(result.suborders, { pagination: result.pagination }));
});


export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const updated = await subordersService.updateStatus(req.params.id!, req.body.status, req.body.trackingId, req.user!.id);
  res.json(ok(updated));
});
