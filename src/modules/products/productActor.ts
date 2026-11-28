import type { Request } from 'express';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { userHasPermission } from '@middleware/rbac.middleware';
import type { ProductActor } from './productChangePolicy';

/**
 * A vendor prices their own products freely. A platform product admin (product.manage) may change
 * pricing on a vendor's product only as `productChangePolicy` allows.
 */
export async function productActor(req: Request): Promise<ProductActor> {
  const [canManage, canPrice] = await Promise.all([
    userHasPermission(req.user, PERMISSIONS.PRODUCT_MANAGE),
    userHasPermission(req.user, PERMISSIONS.PRODUCT_PRICING),
  ]);
  return { id: req.user!.id, vendorId: req.user!.vendorId ?? null, canManage, canPrice };
}
