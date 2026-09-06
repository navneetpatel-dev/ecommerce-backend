import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { ADMIN_ROLES } from '@core/constants/statuses';
import { inventoryService } from './inventory.service';
import { DEFAULT_LOW_STOCK_THRESHOLD } from '@core/constants/http';

export const getLowStock = asyncHandler(async (req: Request, res: Response) => {
  const threshold = Number(req.query.threshold ?? DEFAULT_LOW_STOCK_THRESHOLD);
  // Vendor-role callers (vendorId set on their session) are always scoped to their own
  // vendor's inventory. Admin/staff callers (no vendorId) see the platform-wide view by
  // default, or a single vendor's view when they pass an explicit ?vendorId= filter.
  const vendorId =
    req.user!.vendorId ?? (typeof req.query.vendorId === 'string' ? req.query.vendorId : undefined);
  res.json(ok(await inventoryService.getLowStock(threshold, vendorId)));
});

export const updateStock = asyncHandler(async (req: Request, res: Response) => {
  res.json(ok(await inventoryService.updateStock(req.params.variantId!, req.body.stock, req.user!.id)));
});

export const createStockAlert = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id ?? null;
  const guestEmail = userId ? undefined : req.body.guestEmail;
  const alert = await inventoryService.createStockAlert(req.body.variantId, userId, guestEmail);
  res.status(201).json(ok(alert));
});

export const deleteStockAlert = asyncHandler(async (req: Request, res: Response) => {
  const isAdmin = !!req.user?.role?.name && (ADMIN_ROLES as readonly string[]).includes(req.user.role.name);
  await inventoryService.deleteStockAlert(req.params.id!, {
    userId: req.user?.id,
    isAdmin,
    guestEmail: typeof req.query.guestEmail === 'string' ? req.query.guestEmail : undefined,
  });
  res.json(ok({ success: true }));
});
