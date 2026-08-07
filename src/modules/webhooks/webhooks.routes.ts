import { Router } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import * as paymentsController from '@modules/payments/payments.controller';
import { handleSesEvent } from '@modules/notifications/sesWebhook.service';

const router = Router();

router.post('/razorpay', paymentsController.handleRazorpayWebhook);

router.post(
  '/ses',
  asyncHandler(async (req, res) => {
    const payload =
      Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString('utf8')) : req.body;
    const result = await handleSesEvent(payload);
    res.json(ok(result));
  }),
);

export default router;
