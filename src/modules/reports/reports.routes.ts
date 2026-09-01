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
import { reportExportGuard } from './reportExportGuard';
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
  '/admin/exports',
  authenticate,
  authorize(PERMISSIONS.COMMISSION_VIEW),
  reportsController.listAdminExports,
);
router.post(
  '/exports/:id/retry',
  authenticate,
  reportsController.retryExport,
);
router.post(
  '/admin/exports/:id/retry',
  authenticate,
  authorize(PERMISSIONS.COMMISSION_VIEW),
  reportsController.retryAdminExport,
);
router.get(
  '/customer/order-history',
  authenticate,
  validate(CustomerOrderHistorySchema, 'query'),
  reportExportGuard,
  reportsController.customerOrderHistory,
);
router.get(
  '/customer/order-invoice/:orderId/:subOrderId',
  authenticate,
  reportsController.customerOrderSubInvoice,
);
router.get(
  '/customer/order-invoice/:orderId',
  authenticate,
  reportsController.customerOrderInvoice,
);
router.get(
  '/vendor/sub-orders/:subOrderId/invoice',
  authenticate,
  authorize(PERMISSIONS.SUBORDER_MANAGE, PERMISSIONS.PAYOUT_VIEW),
  reportsController.vendorSubOrderInvoice,
);
router.get(
  '/run/:type',
  authenticate,
  validate(EngineReportQuerySchema, 'query'),
  reportExportGuard,
  reportsController.runReport,
);

// Legacy settlement / wallet reports
router.get(
  '/admin/summary',
  authenticate,
  authorize(PERMISSIONS.COMMISSION_VIEW),
  validate(ReportRangeSchema, 'query'),
  reportExportGuard,
  reportsController.adminSummary,
);

router.get(
  '/admin/vendors',
  authenticate,
  authorize(PERMISSIONS.COMMISSION_VIEW),
  validate(ReportRangeSchema, 'query'),
  reportExportGuard,
  reportsController.adminVendors,
);

router.get(
  '/admin/reconciliation',
  authenticate,
  authorize(PERMISSIONS.COMMISSION_VIEW),
  validate(ReportRangeSchema, 'query'),
  reportExportGuard,
  reportsController.adminReconciliation,
);

router.get(
  '/vendor/:vendorId',
  authenticate,
  authorize(PERMISSIONS.PAYOUT_VIEW, PERMISSIONS.COMMISSION_VIEW),
  validate(ReportRangeSchema, 'query'),
  reportExportGuard,
  reportsController.vendorSummary,
);

router.get(
  '/admin/wallet-liability',
  authenticate,
  authorize(PERMISSIONS.ANALYTICS_VIEW, PERMISSIONS.COMMISSION_VIEW),
  validate(ReportRangeSchema, 'query'),
  reportExportGuard,
  reportsController.walletLiability,
);

router.get(
  '/admin/wallet-recharge',
  authenticate,
  authorize(PERMISSIONS.ANALYTICS_VIEW, PERMISSIONS.COMMISSION_VIEW),
  validate(ReportRangeSchema, 'query'),
  reportExportGuard,
  reportsController.walletRecharge,
);

router.get(
  '/admin/cashback-write-offs',
  authenticate,
  authorize(PERMISSIONS.ANALYTICS_VIEW, PERMISSIONS.COMMISSION_VIEW),
  validate(WriteOffReportSchema, 'query'),
  reportExportGuard,
  reportsController.cashbackWriteOff,
);

export default router;
