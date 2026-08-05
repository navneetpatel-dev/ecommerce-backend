// SubOrders module - Vendor-specific sub-order management
import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { z } from 'zod';
import { validate } from '@middleware/validate.middleware';

const UpdateSubOrderStatusSchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED']),
  trackingId: z.string().optional(),
});

const router = Router();

router.get('/', authenticate, authorize('suborders.view'), asyncHandler(async (_req, res) => {
  // TODO: Implement vendor sub-orders listing
  res.json(ok([]));
}));

router.patch('/:id/status', authenticate, authorize('suborders.update'), validate(UpdateSubOrderStatusSchema), asyncHandler(async (req, res) => {
  // TODO: Implement sub-order status update
  res.json(ok({ message: 'Sub-order updated' }));
}));

export default router;
