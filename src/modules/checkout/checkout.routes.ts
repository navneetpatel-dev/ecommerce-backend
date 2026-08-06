import { Router } from 'express';
import * as checkoutController from './checkout.controller';
import { authenticate } from '@middleware/auth.middleware';
import { validate } from '@middleware/validate.middleware';
import { CreateCheckoutSchema, CheckoutQuoteSchema } from './checkout.dto';
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
  validate(CreateCheckoutSchema),
  checkoutController.createCheckout,
);

router.post(
  '/verify',
  authenticate,
  validate(VerifyPaymentSchema),
  checkoutController.verifyCheckoutPayment,
);

export default router;
