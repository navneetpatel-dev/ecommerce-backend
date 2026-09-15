import './engine/reportExportSource'; // registers the 'report' export domain — side-effect import, keep first
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

router.get('/catalog', authenticate, reportsController.catalog);
router.get(
  '/run/:type',
  authenticate,
  validate(EngineReportQuerySchema, 'query'),
  reportExportGuard,
  reportsController.runReport,
);
router.get(
  '/customer/order-history',
  authenticate,
  validate(CustomerOrderHistorySchema, 'query'),
  reportExportGuard,
  reportsController.customerOrderHistory,
);
router.get(
  '/customer/order-invoice/:orderId',
  authenticate,
  reportsController.customerOrderInvoice,
);
router.get(
  '/customer/order-invoice/:orderId/:subOrderId',
  authenticate,
  reportsController.customerOrderSubInvoice,
);
router.get(
  '/vendor/sub-orders/:subOrderId/invoice',
  authenticate,
  reportsController.vendorSubOrderInvoice,
);

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
  '/admin/wallet-liability',
  authenticate,
  authorize(PERMISSIONS.COMMISSION_VIEW),
  validate(ReportRangeSchema, 'query'),
  reportExportGuard,
  reportsController.walletLiability,
);
router.get(
  '/admin/wallet-recharge',
  authenticate,
  authorize(PERMISSIONS.COMMISSION_VIEW),
  validate(ReportRangeSchema, 'query'),
  reportExportGuard,
  reportsController.walletRecharge,
);
router.get(
  '/admin/cashback-write-offs',
  authenticate,
  authorize(PERMISSIONS.COMMISSION_VIEW),
  validate(WriteOffReportSchema, 'query'),
  reportExportGuard,
  reportsController.cashbackWriteOff,
);
router.get(
  '/vendor/:vendorId/summary',
  authenticate,
  authorize(PERMISSIONS.PAYOUT_VIEW),
  validate(ReportRangeSchema, 'query'),
  reportExportGuard,
  reportsController.vendorSummary,
);

export default router;
