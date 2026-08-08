import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import {
  ReportRangeSchema,
  WriteOffReportSchema,
  EngineReportQuerySchema,
  CustomerOrderHistorySchema,
} from './reports.dto';
import * as reportsController from './reports.controller';

const router = Router();

// Shared report engine
router.get('/catalog', authenticate, reportsController.catalog);
router.get(
  '/exports/:id/download',
  authenticate,
  reportsController.downloadExport,
);
router.get(
  '/exports/:id',
  authenticate,
  reportsController.exportStatus,
);
router.get(
  '/customer/order-history',
  authenticate,
  validate(CustomerOrderHistorySchema, 'query'),
  reportsController.customerOrderHistory,
);
router.get(
  '/customer/order-invoice/:orderId',
  authenticate,
  reportsController.customerOrderInvoice,
);
router.get(
  '/run/:type',
  authenticate,
  validate(EngineReportQuerySchema, 'query'),
  reportsController.runReport,
);

// Legacy settlement / wallet reports
router.get(
  '/admin/summary',
  authenticate,
  authorize(PERMISSIONS.COMMISSION_VIEW),
  validate(ReportRangeSchema, 'query'),
  reportsController.adminSummary,
);

router.get(
  '/admin/vendors',
  authenticate,
  authorize(PERMISSIONS.COMMISSION_VIEW),
  validate(ReportRangeSchema, 'query'),
  reportsController.adminVendors,
);

router.get(
  '/admin/reconciliation',
  authenticate,
  authorize(PERMISSIONS.COMMISSION_VIEW),
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

router.get(
  '/admin/wallet-liability',
  authenticate,
  authorize(PERMISSIONS.ANALYTICS_VIEW, PERMISSIONS.COMMISSION_VIEW),
  validate(ReportRangeSchema, 'query'),
  reportsController.walletLiability,
);

router.get(
  '/admin/cashback-write-offs',
  authenticate,
  authorize(PERMISSIONS.ANALYTICS_VIEW, PERMISSIONS.COMMISSION_VIEW),
  validate(WriteOffReportSchema, 'query'),
  reportsController.cashbackWriteOff,
);

export default router;
