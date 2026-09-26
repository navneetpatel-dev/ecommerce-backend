/**
 * Online checkouts nobody paid for are cancelled after their payment window, and a
 * payment that lands on an order already cancelled unpaid is refunded, never revived.
 */
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { afterEach, describe, it, mock } from 'node:test';
import { env } from '@config/env';
import { razorpayConfigured } from '@config/razorpay';
import { sequelize } from '@database/models';
import { Order } from '@database/models/order.model';
import { WebhookEvent } from '@database/models/webhookEvent.model';
import { ORDER_STATUS, PAYMENT_STATUS } from '@core/constants/statuses';
import { notificationsService } from '@modules/notifications/notifications.service';
import { paymentsService } from '../payments.service';

describe('expireAbandonedCheckouts', () => {
  afterEach(() => mock.restoreAll());

  it('cancels unpaid online orders past the window and reports what it skipped', async () => {
    let where: Record<string, unknown> | undefined;
    mock.method(Order, 'findAll', async (options: { where: Record<string, unknown> }) => {
      where = options.where;
      return [
        { id: 'order-no-gateway', userId: 'u1', razorpayOrderId: null },
        { id: 'order-at-gateway', userId: 'u2', razorpayOrderId: 'order_rzp_1' },
      ] as never;
    });
    const cancelled: unknown[] = [];
    mock.method(paymentsService as never, 'cancelUnpaidOrder', async (target: { id: string }) => {
      cancelled.push(target);
      return target.id;
    });
    mock.method(notificationsService, 'sendOrderCancelled', () => undefined);

    const now = new Date('2026-09-26T12:00:00Z');
    const result = await paymentsService.expireAbandonedCheckouts(now);

    assert.equal(where?.paymentStatus, PAYMENT_STATUS.PENDING);
    assert.equal(
      (where?.createdAt as Record<symbol, Date>)[Object.getOwnPropertySymbols(where?.createdAt as object)[0]!]
        .getTime(),
      now.getTime() - env.CHECKOUT_PENDING_PAYMENT_TTL_MINUTES * 60_000,
    );
    // An order with no Razorpay order was never payable: it goes.
    assert.deepEqual(cancelled[0], { id: 'order-no-gateway' });
    if (!razorpayConfigured) {
      // Without the gateway to confirm nothing was paid, the other one waits.
      assert.deepEqual(result, { expired: 1, skipped: 1 });
    }
  });
});

describe('payment captured on a cancelled order', () => {
  afterEach(() => mock.restoreAll());

  it('refunds the card instead of reviving the order', async (t) => {
    if (!env.RAZORPAY_WEBHOOK_SECRET) return t.skip('RAZORPAY_WEBHOOK_SECRET unset');
    mock.method(WebhookEvent, 'findOrCreate', async () => [{}, true] as never);
    mock.method(sequelize, 'transaction', async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ LOCK: { UPDATE: 'UPDATE' } }),
    );
    const updates: Array<Record<string, unknown>> = [];
    const order = {
      id: 'order-expired',
      userId: 'u1',
      status: ORDER_STATUS.CANCELLED,
      paymentStatus: PAYMENT_STATUS.FAILED,
      update: async (values: Record<string, unknown>) => {
        updates.push(values);
        return order;
      },
    };
    mock.method(Order, 'findOne', async () => order as never);
    const refunds: Array<[string, number, Record<string, string>]> = [];
    mock.method(paymentsService, 'createRazorpayRefund', async (paymentId: string, amount: number, notes: Record<string, string>) => {
      refunds.push([paymentId, amount, notes]);
      return 'rfnd_late';
    });

    const body = JSON.stringify({
      id: `evt_${crypto.randomUUID()}`,
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_late', order_id: 'order_rzp_x', amount: 120_000 } } },
    });
    const signature = crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex');
    await paymentsService.handleRazorpayWebhook(body, signature);

    assert.deepEqual(refunds, [['pay_late', 120_000, { orderId: 'order-expired', reason: 'ORDER_CANCEL' }]]);
    assert.ok(updates.every((values) => values.status !== ORDER_STATUS.CONFIRMED), 'never revived');
    assert.deepEqual(updates.at(-1), {
      paymentStatus: PAYMENT_STATUS.PAID,
      cancelRefundStatus: 'INITIATED',
      cancelRazorpayRefundId: 'rfnd_late',
      cancelRefundAmountPaise: 120_000,
    });
  });
});
