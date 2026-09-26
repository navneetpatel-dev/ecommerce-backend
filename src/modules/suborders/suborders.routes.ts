import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { checkOwnership } from '@middleware/ownership.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { UpdateSubOrderStatusSchema, GetSubOrdersQuerySchema } from './suborders.dto';
import * as subordersController from './suborders.controller';

const router = Router();

router.get('/', authenticate, authorize(PERMISSIONS.SUBORDER_MANAGE), validate(GetSubOrdersQuerySchema, 'query'), subordersController.list);
router.patch('/:id/status', authenticate, authorize(PERMISSIONS.SUBORDER_MANAGE), checkOwnership('suborder'), validate(UpdateSubOrderStatusSchema), subordersController.updateStatus);
router.post('/:id/retry-refund', authenticate, authorize(PERMISSIONS.ORDER_REFUND), subordersController.retryRefund);


export default router;
