import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { inventoryService } from './inventory.service';
import { DEFAULT_LOW_STOCK_THRESHOLD } from '@core/constants/http';

export const getLowStock = asyncHandler(async (req: Request, res: Response) => {
  const threshold = Number(req.query.threshold ?? DEFAULT_LOW_STOCK_THRESHOLD);
  res.json(ok(await inventoryService.getLowStock(threshold)));
});

export const updateStock = asyncHandler(async (req: Request, res: Response) => {
  res.json(ok(await inventoryService.updateStock(req.params.variantId!, req.body.stock, req.user!.id)));
});
