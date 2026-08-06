// Returns module - Return request management
import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { z } from 'zod';
import { validate } from '@middleware/validate.middleware';
import { returnsService } from './returns.service';

const CreateReturnRequestSchema = z.object({
  orderItemId: z.string().uuid(),
  reasonCode: z.enum(['DAMAGED', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'NO_LONGER_NEEDED', 'OTHER']),
  reason: z.string().min(1),
});

const TransitionReturnSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED', 'PICKUP_SCHEDULED', 'RECEIVED', 'REFUNDED', 'CLOSED']),
});

const router = Router();

router.post('/', authenticate, validate(CreateReturnRequestSchema), asyncHandler(async (req, res) => {
  const created = await returnsService.create(req.user!.id, req.body);
  res.status(201).json(ok(created));
}));

router.get('/', authenticate, asyncHandler(async (req, res) => {
  const list = await returnsService.listForUser(req.user!.id);
  res.json(ok(list));
}));

router.patch('/:id/transition', authenticate, authorize('returns.manage'), validate(TransitionReturnSchema), asyncHandler(async (req, res) => {
  const updated = await returnsService.transition(req.params.id!, req.body.status, req.user!.id);
  res.json(ok(updated));
}));

export default router;
