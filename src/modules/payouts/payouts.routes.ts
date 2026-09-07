import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { validate } from '@middleware/validate.middleware';
import { MarkPayoutFailedSchema, MarkPayoutPaidSchema } from './payouts.dto';
import * as payoutsController from './payouts.controller';

const router = Router();

router.get('/', authenticate, authorize(PERMISSIONS.PAYOUT_VIEW, PERMISSIONS.PAYOUT_MANAGE), payoutsController.list);
router.post('/process', authenticate, authorize(PERMISSIONS.PAYOUT_MANAGE), payoutsController.process);
router.patch('/:id/mark-paid', authenticate, authorize(PERMISSIONS.PAYOUT_MANAGE), validate(MarkPayoutPaidSchema), payoutsController.markPaid);
router.patch('/:id/mark-failed', authenticate, authorize(PERMISSIONS.PAYOUT_MANAGE), validate(MarkPayoutFailedSchema), payoutsController.markFailed);
router.patch('/:id/retry', authenticate, authorize(PERMISSIONS.PAYOUT_MANAGE), payoutsController.retry);
router.get(
  '/vendor/:vendorId',
  authenticate,
  authorize(PERMISSIONS.PAYOUT_VIEW, PERMISSIONS.PAYOUT_MANAGE),
  payoutsController.listByVendor,
);

export default router;
