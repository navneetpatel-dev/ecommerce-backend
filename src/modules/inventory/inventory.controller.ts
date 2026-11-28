import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { PERMISSIONS } from '@core/constants/permissions';
import { userHasPermission } from '@middleware/rbac.middleware';
import { inventoryService } from './inventory.service';
import { ProductVariant } from '@database/models/productVariant.model';
import { productActor } from '@modules/products/productActor';
import { recordStockEdit } from '@modules/products/productAdminChanges';
import { cancelStockAlertByToken } from './stockAlerts.service';
import { LowStockQuerySchema } from './inventory.dto';

export const getLowStock = asyncHandler(async (req: Request, res: Response) => {
  const query = LowStockQuerySchema.parse(req.query);
  // A vendor (vendorId on the session) only ever sees its own stock. The platform (no store) sees
  // the whole platform, or one vendor's with ?vendorId=.
  const vendorId = req.user!.vendorId ?? query.vendorId;
  const { rows, pagination } = await inventoryService.getLowStock({ ...query, vendorId });
  res.json(ok(rows, { pagination }));
});

export const updateStock = asyncHandler(async (req: Request, res: Response) => {
  const variantId = req.params.variantId!;
  const before = await ProductVariant.findByPk(variantId, { attributes: ['id', 'stock'] });
  const updated = await inventoryService.updateStock(variantId, req.body.stock, req.user!.id, req.body.expectedStock);
  // A platform admin's change to a vendor's stock is audited and told to the vendor.
  await recordStockEdit(await productActor(req), variantId, Number(before?.stock ?? 0), Number(updated.stock));
  res.json(ok(updated));
});

export const createStockAlert = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id ?? null;
  const guestEmail = userId ? undefined : req.body.guestEmail;
  const alert = await inventoryService.createStockAlert(req.body.variantId, userId, guestEmail);
  // A guest typed an address nobody verified: say only that it is registered, never the record.
  res.status(201).json(ok(userId ? alert : { subscribed: true }));
});

export const deleteStockAlert = asyncHandler(async (req: Request, res: Response) => {
  const isAdmin = await userHasPermission(req.user, PERMISSIONS.PRODUCT_MANAGE);
  await inventoryService.deleteStockAlert(req.params.id!, { userId: req.user!.id, isAdmin });
  res.json(ok({ success: true }));
});

export const cancelStockAlert = asyncHandler(async (req: Request, res: Response) => {
  res.json(ok(await cancelStockAlertByToken(req.body.token)));
});
