/**
 * `refund.processed` for a cancellation refund settles the order it belongs to.
 * A sub-order cancellation refund used to fall through to the return matcher,
 * leaving a fully cancelled order PAID (and its refund INITIATED) forever.
 */
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { afterEach, describe, it, mock } from 'node:test';
import { env } from '@config/env';
import { Order } from '@database/models/order.model';
import { WebhookEvent } from '@database/models/webhookEvent.model';
import { ORDER_STATUS, PAYMENT_STATUS } from '@core/constants/statuses';
import { returnsService } from '@modules/returns/returns.service';
import { paymentsService } from '../payments.service';

function signedRefundEvent(notes: Record<string, string>) {
  const body = JSON.stringify({
    id: `evt_refund_${crypto.randomUUID()}`,
    event: 'refund.processed',
    payload: {
      refund: {
        entity: {
          id: 'rfnd_last_cancel',
          payment_id: 'pay_cancelled',
          amount: 50_000,
          status: 'processed',
          notes,
        },
      },
    },
  });
  const signature = crypto
    .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET!)
    .update(body)
    .digest('hex');
  return { body, signature };
}

describe('PaymentsService cancellation refund webhook', () => {
  afterEach(() => mock.restoreAll());

  it('marks a fully cancelled order REFUNDED when its sub-order cancel refund lands', async (t) => {
    if (!env.RAZORPAY_WEBHOOK_SECRET) return t.skip('RAZORPAY_WEBHOOK_SECRET unset');

    mock.method(WebhookEvent, 'findOrCreate', async () => [{}, true] as never);
    const updates: Array<{ values: Record<string, unknown>; where: Record<string, unknown> }> = [];
    mock.method(Order, 'update', async (values: Record<string, unknown>, options: { where: Record<string, unknown> }) => {
      updates.push({ values, where: options.where });
      return [1] as never;
    });
    const returnMatcher = mock.method(returnsService, 'markRazorpayRefundProcessed', async () => undefined);

    const { body, signature } = signedRefundEvent({
      orderId: 'order-cancelled',
      reason: 'SUBORDER_CANCEL',
      subOrderId: 'sub-last',
    });
    await paymentsService.handleRazorpayWebhook(body, signature);

    assert.deepEqual(updates, [
      {
        values: { paymentStatus: PAYMENT_STATUS.REFUNDED, cancelRefundStatus: 'COMPLETED' },
        // Only the refund recorded for the whole-order cancellation settles it;
        // an earlier partial-cancel refund matches no row.
        where: {
          id: 'order-cancelled',
          // Cancelled, or every part came back undelivered (RTO).
          status: [ORDER_STATUS.CANCELLED, ORDER_STATUS.RETURNED],
          cancelRazorpayRefundId: 'rfnd_last_cancel',
        },
      },
    ]);
    assert.equal(returnMatcher.mock.callCount(), 0, 'a cancellation refund is never matched to a return');
  });

  it('still routes return refunds to the return matcher', async (t) => {
    if (!env.RAZORPAY_WEBHOOK_SECRET) return t.skip('RAZORPAY_WEBHOOK_SECRET unset');

    mock.method(WebhookEvent, 'findOrCreate', async () => [{}, true] as never);
    const orderUpdate = mock.method(Order, 'update', async () => [1] as never);
    const returnMatcher = mock.method(returnsService, 'markRazorpayRefundProcessed', async () => undefined);

    const { body, signature } = signedRefundEvent({ returnRequestId: 'return-1' });
    await paymentsService.handleRazorpayWebhook(body, signature);

    assert.equal(orderUpdate.mock.callCount(), 0);
    assert.equal(returnMatcher.mock.callCount(), 1);
  });
});
