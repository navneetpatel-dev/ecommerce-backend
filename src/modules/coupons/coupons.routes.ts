import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { VENDOR_ROLES } from '@core/constants/statuses';
import {
  CreateCouponSchema,
  UpdateCouponSchema,
  ApplyCouponSchema,
  BulkGenerateSchema,
  StatusSchema,
  EligibleCouponsQuerySchema,
  PublicEligibleCouponsQuerySchema,
} from './coupons.dto';
import * as couponsController from './coupons.controller';

const router = Router();

function requireVendorRole(req: Request, _res: Response, next: NextFunction) {
  const role = req.user?.role?.name;
  if (!role || !(VENDOR_ROLES as readonly string[]).includes(role) || !req.user?.vendorId) {
    return next(new ForbiddenError(ERROR_MESSAGES.AUTH_REQUIRED));
  }
  return next();
}

// Customer
router.post('/apply', authenticate, validate(ApplyCouponSchema), couponsController.applyCoupon);
router.delete('/remove', authenticate, couponsController.removeCoupon);
router.get(
  '/eligible',
  authenticate,
  validate(EligibleCouponsQuerySchema, 'query'),
  couponsController.eligibleCoupons,
);
router.get(
  '/eligible-public',
  validate(PublicEligibleCouponsQuerySchema, 'query'),
  couponsController.eligibleCouponsPublic,
);

// Vendor (authenticate + vendorId; no COUPON_MANAGE)
router.post(
  '/vendor',
  authenticate,
  requireVendorRole,
  validate(CreateCouponSchema),
  couponsController.createVendorCoupon,
);
router.get('/vendor', authenticate, requireVendorRole, couponsController.listVendorCoupons);
router.get(
  '/vendor/absorbed-summary',
  authenticate,
  requireVendorRole,
  couponsController.vendorAbsorbedSummary,
);
router.patch(
  '/vendor/:id',
  authenticate,
  requireVendorRole,
  validate(UpdateCouponSchema),
  couponsController.updateCoupon,
);
router.get('/vendor/:id', authenticate, requireVendorRole, couponsController.getCoupon);
router.get('/vendor/:id/analytics', authenticate, requireVendorRole, couponsController.couponAnalytics);
router.patch(
  '/vendor/:id/status',
  authenticate,
  requireVendorRole,
  validate(StatusSchema),
  couponsController.setCouponStatus,
);

// Admin
router.get('/batches', authenticate, authorize(PERMISSIONS.COUPON_MANAGE), couponsController.listBatches);
router.post(
  '/jobs/notify-alerts',
  authenticate,
  authorize(PERMISSIONS.COUPON_MANAGE),
  couponsController.runCouponAlertJob,
);
router.post(
  '/bulk',
  authenticate,
  authorize(PERMISSIONS.COUPON_MANAGE),
  validate(BulkGenerateSchema),
  couponsController.bulkGenerate,
);
router.post(
  '/',
  authenticate,
  authorize(PERMISSIONS.COUPON_MANAGE),
  validate(CreateCouponSchema),
  couponsController.createCoupon,
);
router.get('/', authenticate, authorize(PERMISSIONS.COUPON_MANAGE), couponsController.listCoupons);
router.get('/:id/analytics', authenticate, authorize(PERMISSIONS.COUPON_MANAGE), couponsController.couponAnalytics);
router.patch(
  '/:id/status',
  authenticate,
  authorize(PERMISSIONS.COUPON_MANAGE),
  validate(StatusSchema),
  couponsController.setCouponStatus,
);
router.get('/:id', authenticate, authorize(PERMISSIONS.COUPON_MANAGE), couponsController.getCoupon);
router.patch(
  '/:id',
  authenticate,
  authorize(PERMISSIONS.COUPON_MANAGE),
  validate(UpdateCouponSchema),
  couponsController.updateCoupon,
);

export default router;
