import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import * as payoutsController from './payouts.controller';

const router = Router();

router.get('/', authenticate, authorize(PERMISSIONS.PAYOUT_VIEW, PERMISSIONS.PAYOUT_MANAGE), payoutsController.list);
router.post('/process', authenticate, authorize(PERMISSIONS.PAYOUT_MANAGE), payoutsController.process);
router.get('/vendor/:vendorId', authenticate, payoutsController.listByVendor);

export default router;
