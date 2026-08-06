import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { CreateCouponSchema, ApplyCouponSchema } from './coupons.dto';
import * as couponsController from './coupons.controller';

const router = Router();

router.post('/', authenticate, authorize(PERMISSIONS.COUPON_MANAGE), validate(CreateCouponSchema), couponsController.createCoupon);
router.get('/', authenticate, authorize(PERMISSIONS.COUPON_MANAGE), couponsController.listCoupons);

router.post('/apply', authenticate, validate(ApplyCouponSchema), couponsController.applyCoupon);
router.delete('/remove', authenticate, couponsController.removeCoupon);

export default router;
