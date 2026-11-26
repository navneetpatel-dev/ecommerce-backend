import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ERROR_MESSAGES } from '@core/constants/errors';

/**
 * The caller must belong to a store. Permissions alone are not enough: admin roles hold
 * vendor-style permissions (suborder.manage, product.create) without a `vendorId`, and every
 * `/vendors/me*` and vendor-dashboard handler reads `req.user.vendorId`.
 */
export function requireVendorContext(req: Request, _res: Response, next: NextFunction) {
  if (!req.user?.vendorId) {
    return next(new ForbiddenError(ERROR_MESSAGES.VENDOR_NOT_LINKED));
  }
  return next();
}
