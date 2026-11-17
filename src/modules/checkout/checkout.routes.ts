import { Router } from 'express';
import * as checkoutController from './checkout.controller';
import { authenticate } from '@middleware/auth.middleware';
import { blockNewPurchasesDuringMaintenance } from '@middleware/maintenance.middleware';
import { validate } from '@middleware/validate.middleware';
import {
  CancelCheckoutSchema,
  CreateCheckoutSchema,
  CheckoutQuoteSchema,
  ResumeCheckoutSchema,
} from './checkout.dto';
import { VerifyPaymentSchema } from '@modules/payments/payments.dto';

const router = Router();

router.post(
  '/quote',
  authenticate,
  validate(CheckoutQuoteSchema),
  checkoutController.getCheckoutQuote,
);

router.post(
  '/',
  authenticate,
  blockNewPurchasesDuringMaintenance,
  validate(CreateCheckoutSchema),
  checkoutController.createCheckout,
);

router.post(
  '/verify',
  authenticate,
  validate(VerifyPaymentSchema),
  checkoutController.verifyCheckoutPayment,
);

router.post(
  '/cancel',
  authenticate,
  validate(CancelCheckoutSchema),
  checkoutController.cancelCheckout,
);

router.post(
  '/resume',
  authenticate,
  blockNewPurchasesDuringMaintenance,
  validate(ResumeCheckoutSchema),
  checkoutController.resumeCheckout,
);

export default router;
