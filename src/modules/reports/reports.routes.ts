import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { ReportRangeSchema } from './reports.dto';
import * as reportsController from './reports.controller';

const router = Router();

router.get(
  '/admin/summary',
  authenticate,
  authorize(PERMISSIONS.ANALYTICS_VIEW, PERMISSIONS.COMMISSION_VIEW),
  validate(ReportRangeSchema, 'query'),
  reportsController.adminSummary,
);

router.get(
  '/admin/vendors',
  authenticate,
  authorize(PERMISSIONS.ANALYTICS_VIEW, PERMISSIONS.COMMISSION_VIEW),
  validate(ReportRangeSchema, 'query'),
  reportsController.adminVendors,
);

router.get(
  '/admin/reconciliation',
  authenticate,
  authorize(PERMISSIONS.ANALYTICS_VIEW, PERMISSIONS.COMMISSION_VIEW),
  validate(ReportRangeSchema, 'query'),
  reportsController.adminReconciliation,
);

router.get(
  '/vendor/:vendorId',
  authenticate,
  authorize(PERMISSIONS.PAYOUT_VIEW, PERMISSIONS.COMMISSION_VIEW),
  validate(ReportRangeSchema, 'query'),
  reportsController.vendorSummary,
);

export default router;
