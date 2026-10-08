import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { handleSesEvent } from '@modules/notifications/sesWebhook.service';
import * as paymentsController from '@modules/payments/payments.controller';
import { parseSesEventBody } from './webhooks.payload';

/**
 * Webhooks gateway module. It owns the two inbound webhook routes and nothing
 * else: signature verification + business handling live in the owning domains
 * (payments for Razorpay, notifications for SES), which keeps this module a
 * thin, auditable gateway.
 */

/** Razorpay webhook — delegate to the payments module's verified handler. */
export const handleRazorpay = paymentsController.handleRazorpayWebhook;

/** SES event sink — parse the payload and hand it to the notifications module. */
export const handleSes = asyncHandler(async (req: Request, res: Response) => {
  const payload = parseSesEventBody(req.body);
  const result = await handleSesEvent(payload);
  res.json(ok(result));
});
