/**
 * Online checkouts nobody paid for are cancelled after their payment window, and a
 * payment that lands on an order already cancelled unpaid is refunded, never revived.
 */
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { afterEach, describe, it, mock } from 'node:test';
import { env } from '@config/env';
import { sequelize } from '@database/models';
import { Order } from '@database/models/order.model';
import { WebhookEvent } from '@database/models/webhookEvent.model';
import { Coupon } from '@database/models/coupon.model';
import { ORDER_STATUS, PAYMENT_STATUS } from '@core/constants/statuses';
import { notificationsService } from '@modules/notifications/notifications.service';
import { paymentsService } from '../payments.service';
import { expireAbandonedCheckouts } from '../abandonedCheckouts';
import { razorpayOrderPayments } from '../razorpayOrderPayments';
import { unpaidOrders } from '../unpaidOrderCancel';

describe('expireAbandonedCheckouts', () => {
  afterEach(() => mock.restoreAll());

  function stubStale(batches: Array<Array<Record<string, unknown>>>) {
    const wheres: Array<Record<string, unknown>> = [];
    let call = 0;
    mock.method(Order, 'findAll', async (options: { where: Record<string, unknown> }) => {
      wheres.push(options.where);
      return (batches[call++] ?? []) as never;
    });
    mock.method(notificationsService, 'sendOrderCancelled', () => undefined);
    return wheres;
  }

  it('cancels unpaid orders, confirms captured ones and leaves authorized ones', async () => {
    const wheres = stubStale([
      [
        { id: 'order-no-gateway', userId: 'u1', razorpayOrderId: null, createdAt: new Date(1) },
        { id: 'order-captured', userId: 'u2', razorpayOrderId: 'order_rzp_c', createdAt: new Date(2) },
        { id: 'order-authorized', userId: 'u3', razorpayOrderId: 'order_rzp_a', createdAt: new Date(3) },
        { id: 'order-unpaid', userId: 'u4', razorpayOrderId: 'order_rzp_u', createdAt: new Date(4) },
      ],
    ]);
    const captured = { id: 'pay_c', order_id: 'order_rzp_c', status: 'captured', amount: 500 };
    mock.method(razorpayOrderPayments, 'fetch', async (razorpayOrderId: string) =>
      razorpayOrderId === 'order_rzp_c'
        ? { captured, authorized: false }
        : { captured: null, authorized: razorpayOrderId === 'order_rzp_a' },
    );
    const confirmed: unknown[] = [];
    mock.method(paymentsService, 'confirmCapturedPayment', async (payment: unknown) => {
      confirmed.push(payment);
    });
    const cancelled: unknown[] = [];
    mock.method(unpaidOrders, 'cancel', async (target: { id: string }) => {
      cancelled.push(target);
      return target.id;
    });

    const now = new Date('2026-09-26T12:00:00Z');
    const result = await expireAbandonedCheckouts(now);

    assert.equal(wheres[0]?.paymentStatus, PAYMENT_STATUS.PENDING);
    assert.equal(
      (wheres[0]?.createdAt as Record<symbol, Date>)[Object.getOwnPropertySymbols(wheres[0]?.createdAt as object)[0]!]
        .getTime(),
      now.getTime() - env.CHECKOUT_PENDING_PAYMENT_TTL_MINUTES * 60_000,
    );
    assert.deepEqual(cancelled, [{ id: 'order-no-gateway' }, { id: 'order-unpaid' }]);
    assert.deepEqual(confirmed, [captured]);
    assert.deepEqual(result, { expired: 2, reconciled: 1, skipped: 1 });
  });

  it('pages past a full batch it had to leave alone, so newer checkouts still expire', async () => {
    const leftAlone = Array.from({ length: 100 }, (_, i) => ({
      id: `order-${String(i).padStart(3, '0')}`,
      userId: 'u',
      razorpayOrderId: `order_rzp_${i}`,
      createdAt: new Date(1000 + i),
    }));
    const wheres = stubStale([leftAlone, [{ id: 'order-newer', userId: 'u', razorpayOrderId: null, createdAt: new Date(5000) }]]);
    mock.method(razorpayOrderPayments, 'fetch', async () => null);
    const cancelled: unknown[] = [];
    mock.method(unpaidOrders, 'cancel', async (target: { id: string }) => {
      cancelled.push(target);
      return target.id;
    });

    const result = await expireAbandonedCheckouts(new Date('2026-09-26T12:00:00Z'));

    assert.equal(wheres.length, 2);
    assert.deepEqual(cancelled, [{ id: 'order-newer' }]);
    assert.deepEqual(result, { expired: 1, reconciled: 0, skipped: 100 });
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

describe('Razorpay webhook processing', () => {
  afterEach(() => mock.restoreAll());

  function signed(body: Record<string, unknown>) {
    const raw = JSON.stringify(body);
    return {
      raw,
      signature: crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET!).update(raw).digest('hex'),
    };
  }

  it('does not cancel the order on one failed attempt: the customer may retry', async (t) => {
    if (!env.RAZORPAY_WEBHOOK_SECRET) return t.skip('RAZORPAY_WEBHOOK_SECRET unset');
    mock.method(WebhookEvent, 'findOrCreate', async () => [{}, true] as never);
    mock.method(Order, 'findOne', async () => ({ id: 'order-retry', userId: 'u1' }) as never);
    mock.method(notificationsService, 'sendPaymentFailed', () => undefined);
    const cancel = mock.method(unpaidOrders, 'cancel', async () => 'order-retry');

    const { raw, signature } = signed({
      id: `evt_${crypto.randomUUID()}`,
      event: 'payment.failed',
      payload: { payment: { entity: { id: 'pay_f', order_id: 'order_rzp_r' } } },
    });
    await paymentsService.handleRazorpayWebhook(raw, signature);

    assert.equal(cancel.mock.callCount(), 0);
  });

  it('forgets an event whose processing failed, so the retry runs it again', async (t) => {
    if (!env.RAZORPAY_WEBHOOK_SECRET) return t.skip('RAZORPAY_WEBHOOK_SECRET unset');
    mock.method(WebhookEvent, 'findOrCreate', async () => [{}, true] as never);
    const destroyed: unknown[] = [];
    mock.method(WebhookEvent, 'destroy', async (options: unknown) => {
      destroyed.push(options);
      return 1;
    });
    mock.method(paymentsService, 'confirmCapturedPayment', async () => {
      throw new Error('deadlock');
    });

    const { raw, signature } = signed({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_x', order_id: 'order_rzp_x', amount: 100 } } },
    });
    await assert.rejects(paymentsService.handleRazorpayWebhook(raw, signature, 'evt_retry_me'), /deadlock/);

    assert.deepEqual(destroyed, [{ where: { provider: 'razorpay', eventId: 'evt_retry_me' }, force: true }]);
  });

  it('refunds a second captured payment on an order another payment already paid', async () => {
    mock.method(sequelize, 'transaction', async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ LOCK: { UPDATE: 'UPDATE' } }),
    );
    const update = mock.fn(async () => undefined);
    mock.method(Order, 'findOne', async () => ({
      id: 'order-paid',
      userId: 'u1',
      status: ORDER_STATUS.CONFIRMED,
      paymentStatus: PAYMENT_STATUS.PAID,
      razorpayPaymentId: 'pay_first',
      update,
    }) as never);
    const refunds: unknown[] = [];
    mock.method(paymentsService, 'createRazorpayRefund', async (...args: unknown[]) => {
      refunds.push(args);
      return 'rfnd_dup';
    });

    await paymentsService.confirmCapturedPayment({ id: 'pay_second', order_id: 'order_rzp_p', amount: 90_000 });
    // The same payment again is just a repeat: nothing to refund.
    await paymentsService.confirmCapturedPayment({ id: 'pay_first', order_id: 'order_rzp_p', amount: 90_000 });

    assert.deepEqual(refunds, [
      ['pay_second', 90_000, { orderId: 'order-paid', paymentId: 'pay_second', reason: 'DUPLICATE_PAYMENT' }],
    ]);
    assert.equal(update.mock.callCount(), 0);
  });
});

describe('captured amount check', () => {
  afterEach(() => mock.restoreAll());

  function stubPendingOrder() {
    mock.method(sequelize, 'transaction', async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ LOCK: { UPDATE: 'UPDATE' } }),
    );
    const updates: Array<Record<string, unknown>> = [];
    mock.method(Order, 'findOne', async () => ({
      id: 'order-due',
      userId: 'u1',
      status: ORDER_STATUS.PENDING,
      paymentStatus: PAYMENT_STATUS.PENDING,
      // ₹1,200 order, ₹200 of it paid from the wallet: Razorpay is owed ₹1,000.
      totalAmount: 1200,
      walletAmountUsed: 200,
      appliedCouponIds: [],
      couponId: null,
      update: async (values: Record<string, unknown>) => {
        updates.push(values);
      },
    }) as never);
    return updates;
  }

  it('never confirms an order on a capture for another amount, and refunds it', async () => {
    const updates = stubPendingOrder();
    const refunds: unknown[] = [];
    mock.method(paymentsService, 'createRazorpayRefund', async (...args: unknown[]) => {
      refunds.push(args);
      return 'rfnd_mismatch';
    });

    await paymentsService.confirmCapturedPayment({ id: 'pay_short', order_id: 'order_rzp', amount: 1_000, currency: 'INR' });

    assert.equal(updates.length, 0, 'order not confirmed');
    assert.deepEqual(refunds, [['pay_short', 1_000, { orderId: 'order-due', paymentId: 'pay_short', reason: 'AMOUNT_MISMATCH' }]]);
  });

  it('confirms the order on a capture for exactly what it owes', async () => {
    const updates = stubPendingOrder();
    mock.method(Coupon, 'findAll', async () => []);

    await paymentsService.confirmCapturedPayment({ id: 'pay_ok', order_id: 'order_rzp', amount: 100_000, currency: 'INR' });

    assert.equal(updates[0]?.paymentStatus, PAYMENT_STATUS.PAID);
  });
});

