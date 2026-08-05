// Admin module - Basic dashboard and analytics endpoints
import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';

const router = Router();

router.get('/dashboard', authenticate, authorize('admin.dashboard'), asyncHandler(async (_req, res) => {
  // TODO: Implement actual dashboard metrics
  const metrics = {
    totalOrders: 0,
    totalRevenue: 0,
    totalVendors: 0,
    totalCustomers: 0,
    pendingApprovals: 0,
  };
  res.json(ok(metrics));
}));

router.get('/analytics/platform', authenticate, authorize('admin.analytics'), asyncHandler(async (_req, res) => {
  // TODO: Implement GMV, top vendors, top categories analytics
  const analytics = {
    gmv: 0,
    topVendors: [],
    topCategories: [],
  };
  res.json(ok(analytics));
}));

export default router;
