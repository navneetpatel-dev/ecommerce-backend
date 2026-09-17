import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { CreateReturnRequestSchema, RescheduleReturnPickupSchema, TransitionReturnSchema } from './returns.dto';
import * as returnsController from './returns.controller';

const router = Router();

router.post('/', authenticate, validate(CreateReturnRequestSchema), returnsController.create);
router.get('/', authenticate, returnsController.list);
router.get('/admin', authenticate, authorize(PERMISSIONS.ORDER_REFUND), returnsController.listAdmin);
router.get(
  '/vendor/me',
  authenticate,
  authorize(PERMISSIONS.SUBORDER_MANAGE),
  returnsController.listVendor,
);
router.get('/:id', authenticate, returnsController.getById);
router.get('/:id/credit-note', authenticate, returnsController.downloadCreditNote);
router.get(
  '/:id/debit-note',
  authenticate,
  authorize(PERMISSIONS.ORDER_REFUND, PERMISSIONS.PAYOUT_VIEW, PERMISSIONS.SUBORDER_MANAGE),
  returnsController.downloadDebitNote,
);
router.patch('/:id/transition', authenticate, authorize(PERMISSIONS.ORDER_REFUND), validate(TransitionReturnSchema), returnsController.transition);
router.post('/:id/reschedule-pickup', authenticate, validate(RescheduleReturnPickupSchema), returnsController.reschedulePickup);
router.post('/:id/retry-refund', authenticate, authorize(PERMISSIONS.ORDER_REFUND), returnsController.retryRefund);
router.delete('/:id', authenticate, authorize(PERMISSIONS.ORDER_REFUND), returnsController.remove);

export default router;
