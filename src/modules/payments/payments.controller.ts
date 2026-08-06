import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { paymentsService } from './payments.service';
import { VerifyPaymentSchema } from './payments.dto';

/** UX confirmation only — does not mark the order paid. */
export const verifyPayment = asyncHandler(async (req: Request, res: Response) => {
  const dto = VerifyPaymentSchema.parse(req.body);
  const result = paymentsService.verifyPaymentSignature({
    razorpayOrderId: dto.razorpayOrderId!,
    razorpayPaymentId: dto.razorpayPaymentId!,
    razorpaySignature: dto.razorpaySignature!,
  });
  res.json(ok(result));
});

/** Authoritative confirmation — signature-verified + idempotent. */
export const handleRazorpayWebhook = asyncHandler(async (req: Request, res: Response) => {
  const signature = req.headers['x-razorpay-signature'] as string | undefined;
  const rawBody = req.body as Buffer | string;
  const result = await paymentsService.handleRazorpayWebhook(rawBody, signature);
  res.status(200).json(result);
});
