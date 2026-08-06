import { Router } from 'express';
import * as paymentsController from '@modules/payments/payments.controller';

const router = Router();

router.post('/razorpay', paymentsController.handleRazorpayWebhook);

export default router;
