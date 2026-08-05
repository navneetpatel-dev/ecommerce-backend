// Commissions module - Commission tracking and management
import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';

const router = Router();

router.get('/', authenticate, authorize('commissions.view'), asyncHandler(async (_req, res) => {
  // TODO: Implement commission ledger listing
  res.json(ok([]));
}));

router.get('/vendor/:vendorId', authenticate, authorize('commissions.view'), asyncHandler(async (req, res) => {
  // TODO: Implement vendor-specific commission summary
  res.json(ok({ total: 0, pending: 0, settled: 0 }));
}));

export default router;
