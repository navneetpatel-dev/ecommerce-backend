// coupon management and validation
import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { z } from 'zod';
import { validate } from '@middleware/validate.middleware';

const CreateCouponSchema = z.object({
  code: z.string().min(1),
  type: z.enum(['PERCENTAGE', 'FLAT', 'FREE_SHIPPING', 'BOGO', 'TIERED', 'CASHBACK', 'BUNDLE']),
  value: z.number().optional(),
  maxDiscountCap: z.number().optional(),
  minOrderValue: z.number().optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
});

const ApplyCouponSchema = z.object({
  code: z.string(),
});

const router = Router();

// Admin coupon management
router.post('/', authenticate, authorize('coupons.create'), validate(CreateCouponSchema), asyncHandler(async (req, res) => {
  // TODO: Implement coupon creation
  res.status(201).json(ok({ message: 'Coupon created' }));
}));

router.get('/', authenticate, authorize('coupons.view'), asyncHandler(async (_req, res) => {
  // TODO: Implement coupon listing
  res.json(ok([]));
}));

// Customer coupon application
router.post('/apply', authenticate, validate(ApplyCouponSchema), asyncHandler(async (req, res) => {
  // TODO: Implement coupon validation and application
  res.json(ok({ discount: 0 }));
}));

router.delete('/remove', authenticate, asyncHandler(async (_req, res) => {
  // TODO: Implement coupon removal from cart
  res.status(204).send();
}));

export default router;
