import type { Request } from 'express';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { userHasPermission } from '@middleware/rbac.middleware';
import type { ProductActor } from './productChangePolicy';

/**
 * Prices, tax codes and variants belong to the store owner (product.create). A platform product admin
 * (product.manage) may change them only as `productChangePolicy` allows; vendor staff never.
 */
export async function productActor(req: Request): Promise<ProductActor> {
  const [canManage, canCreate, canPrice] = await Promise.all([
    userHasPermission(req.user, PERMISSIONS.PRODUCT_MANAGE),
    userHasPermission(req.user, PERMISSIONS.PRODUCT_CREATE),
    userHasPermission(req.user, PERMISSIONS.PRODUCT_PRICING),
  ]);
  return { id: req.user!.id, vendorId: req.user!.vendorId ?? null, canManage, canCreate, canPrice };
}
