import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { CreateReturnRequestSchema, TransitionReturnSchema } from './returns.dto';
import * as returnsController from './returns.controller';

const router = Router();

router.post('/', authenticate, validate(CreateReturnRequestSchema), returnsController.create);
router.get('/', authenticate, returnsController.list);
router.get('/admin', authenticate, authorize(PERMISSIONS.ORDER_REFUND), returnsController.listAdmin);
router.patch('/:id/transition', authenticate, authorize(PERMISSIONS.ORDER_REFUND), validate(TransitionReturnSchema), returnsController.transition);
router.delete('/:id', authenticate, authorize(PERMISSIONS.ORDER_REFUND), returnsController.remove);

export default router;
