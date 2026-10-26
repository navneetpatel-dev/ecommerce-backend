import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { razorpay, razorpayConfigured } from '@config/razorpay';
import { paymentsService } from '@modules/payments/payments.service';
import { refundIfSupersededRechargePayment } from '../supersededRechargePayment';

describe('refundIfSupersededRechargePayment', () => {
  afterEach(() => mock.restoreAll());

  it('refunds a late payment on a recharge order the recharge no longer uses', async (t) => {
    if (!razorpayConfigured) return t.skip('Razorpay not configured');
    mock.method(razorpay.orders, 'fetch', async () => ({ notes: { type: 'wallet_recharge', rechargeId: 'rch-1' } }) as never);
    const refunds: unknown[] = [];
    mock.method(paymentsService, 'createRazorpayRefund', async (...args: unknown[]) => {
      refunds.push(args);
      return 'rfnd_1';
    });

    assert.equal(await refundIfSupersededRechargePayment('order_old', 'pay_late', 50_000), true);
    assert.deepEqual(refunds, [
      ['pay_late', 50_000, { supersededRechargeId: 'rch-1', paymentId: 'pay_late', reason: 'SUPERSEDED_RECHARGE' }],
    ]);
  });

  it('leaves payments on other kinds of order alone', async (t) => {
    if (!razorpayConfigured) return t.skip('Razorpay not configured');
    mock.method(razorpay.orders, 'fetch', async () => ({ notes: { type: 'gift_card' } }) as never);
    const refund = mock.method(paymentsService, 'createRazorpayRefund', async () => 'rfnd_x');

    assert.equal(await refundIfSupersededRechargePayment('order_x', 'pay_x', 50_000), false);
    assert.equal(refund.mock.callCount(), 0);
  });
});
