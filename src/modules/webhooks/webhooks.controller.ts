import * as paymentsController from '@modules/payments/payments.controller';

/**
 * Webhooks gateway module. It owns the inbound Razorpay webhook route and nothing
 * else: signature verification + business handling live in the owning domain
 * (payments), which keeps this module a thin, auditable gateway.
 */

/** Razorpay webhook — delegate to the payments module's verified handler. */
export const handleRazorpay = paymentsController.handleRazorpayWebhook;
