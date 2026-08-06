import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { validate } from '@middleware/validate.middleware';
import * as paymentsController from './payments.controller';
import { VerifyPaymentSchema } from './payments.dto';

const router = Router();

/** Prefer POST /api/checkout/verify; kept for backward compatibility. */
router.post(
  '/verify',
  authenticate,
  validate(VerifyPaymentSchema),
  paymentsController.verifyPayment,
);

export default router;
