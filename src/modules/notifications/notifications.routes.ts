// Notifications module - Email and SMS notifications via BullMQ
import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';

const router = Router();

router.get('/logs', authenticate, authorize('notifications.view'), asyncHandler(async (_req, res) => {
  // TODO: Implement notification logs listing
  res.json(ok([]));
}));

router.post('/test', authenticate, authorize('notifications.send'), asyncHandler(async (req, res) => {
  // TODO: Implement test notification sending
  res.json(ok({ message: 'Test notification sent' }));
}));

export default router;
