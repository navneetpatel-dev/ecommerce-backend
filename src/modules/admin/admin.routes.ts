import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { reportExportGuard } from '@modules/reports/reportExportGuard';
import * as adminController from './admin.controller';

const router = Router();

router.get('/dashboard', authenticate, authorize(PERMISSIONS.ANALYTICS_VIEW), adminController.getDashboard);
router.get('/analytics/platform', authenticate, authorize(PERMISSIONS.ANALYTICS_VIEW), adminController.getPlatformAnalytics);
router.get('/analytics/platform/export', authenticate, authorize(PERMISSIONS.ANALYTICS_VIEW), reportExportGuard, adminController.exportPlatformAnalytics);

export default router;
