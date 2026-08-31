import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import * as commissionsController from './commissions.controller';

const router = Router();

router.get('/', authenticate, authorize(PERMISSIONS.COMMISSION_VIEW, PERMISSIONS.PAYOUT_VIEW), commissionsController.list);
router.get('/invoices', authenticate, authorize(PERMISSIONS.COMMISSION_VIEW, PERMISSIONS.PAYOUT_VIEW), commissionsController.listInvoices);
router.get('/invoices/:invoiceId/pdf', authenticate, authorize(PERMISSIONS.COMMISSION_VIEW, PERMISSIONS.PAYOUT_VIEW), commissionsController.downloadInvoice);
router.get('/vendor/:vendorId', authenticate, authorize(PERMISSIONS.COMMISSION_VIEW, PERMISSIONS.PAYOUT_VIEW), commissionsController.listByVendor);

export default router;
