/**
 * `refund.processed` for a cancellation refund settles the order it belongs to.
 * A sub-order cancellation refund used to fall through to the return matcher,
 * leaving a fully cancelled order PAID (and its refund INITIATED) forever. Each part
 * now records its own refund; the order settles once all of them have landed.
 */
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { afterEach, describe, it, mock } from 'node:test';
import { env } from '@config/env';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
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

  function stubPartRefundRows(parts: Array<Record<string, unknown>>) {
    mock.method(WebhookEvent, 'findOrCreate', async () => [{}, true] as never);
    const subOrderUpdates: Array<{ values: Record<string, unknown>; where: Record<string, unknown> }> = [];
    mock.method(SubOrder, 'update', async (values: Record<string, unknown>, options: { where: Record<string, unknown> }) => {
      subOrderUpdates.push({ values, where: options.where });
      return [1] as never;
    });
    mock.method(Order, 'findByPk', async () => ({
      id: 'order-cancelled',
      status: ORDER_STATUS.CANCELLED,
      cancelRazorpayRefundId: 'rfnd_last_cancel',
    }) as never);
    mock.method(SubOrder, 'findAll', async () => parts as never);
    const orderUpdates: Array<{ values: Record<string, unknown>; where: Record<string, unknown> }> = [];
    mock.method(Order, 'update', async (values: Record<string, unknown>, options: { where: Record<string, unknown> }) => {
      orderUpdates.push({ values, where: options.where });
      return [1] as never;
    });
    return { subOrderUpdates, orderUpdates };
  }

  it('marks the part refunded, and the order once every part refund has landed', async (t) => {
    if (!env.RAZORPAY_WEBHOOK_SECRET) return t.skip('RAZORPAY_WEBHOOK_SECRET unset');

    const { subOrderUpdates, orderUpdates } = stubPartRefundRows([
      { id: 'sub-first', status: ORDER_STATUS.CANCELLED, cancelRefundAmountPaise: 30_000, cancelRefundStatus: 'COMPLETED' },
      { id: 'sub-last', status: ORDER_STATUS.CANCELLED, cancelRefundAmountPaise: 50_000, cancelRefundStatus: 'COMPLETED' },
    ]);
    const returnMatcher = mock.method(returnsService, 'markRazorpayRefundProcessed', async () => undefined);

    const { body, signature } = signedRefundEvent({
      orderId: 'order-cancelled',
      reason: 'SUBORDER_CANCEL',
      subOrderId: 'sub-last',
    });
    await paymentsService.handleRazorpayWebhook(body, signature);

    assert.deepEqual(subOrderUpdates, [
      {
        values: { cancelRefundStatus: 'COMPLETED' },
        where: { id: 'sub-last', orderId: 'order-cancelled', cancelRazorpayRefundId: 'rfnd_last_cancel' },
      },
    ]);
    assert.deepEqual(orderUpdates, [
      {
        values: { paymentStatus: PAYMENT_STATUS.REFUNDED, cancelRefundStatus: 'COMPLETED' },
        where: { id: 'order-cancelled' },
      },
    ]);
    assert.equal(returnMatcher.mock.callCount(), 0, 'a cancellation refund is never matched to a return');
  });

  it('leaves the order open while another part refund is still in flight', async (t) => {
    if (!env.RAZORPAY_WEBHOOK_SECRET) return t.skip('RAZORPAY_WEBHOOK_SECRET unset');

    const { subOrderUpdates, orderUpdates } = stubPartRefundRows([
      { id: 'sub-first', status: ORDER_STATUS.CANCELLED, cancelRefundAmountPaise: 30_000, cancelRefundStatus: 'FAILED' },
      { id: 'sub-last', status: ORDER_STATUS.CANCELLED, cancelRefundAmountPaise: 50_000, cancelRefundStatus: 'COMPLETED' },
    ]);
    mock.method(returnsService, 'markRazorpayRefundProcessed', async () => undefined);

    const { body, signature } = signedRefundEvent({
      orderId: 'order-cancelled',
      reason: 'SUBORDER_CANCEL',
      subOrderId: 'sub-last',
    });
    await paymentsService.handleRazorpayWebhook(body, signature);

    assert.equal(subOrderUpdates.length, 1);
    assert.deepEqual(orderUpdates, []);
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
