import assert from 'node:assert/strict';
import crypto from 'crypto';
import { afterEach, describe, it, mock } from 'node:test';
import { env } from '@config/env';
import { sequelize } from '@database/models';
import { Coupon } from '@database/models/coupon.model';
import { CouponUsage } from '@database/models/couponUsage.model';
import { Order } from '@database/models/order.model';
import { WebhookEvent } from '@database/models/webhookEvent.model';
import { PAYMENT_STATUS } from '@core/constants/statuses';
import { giftCardsService } from '@modules/giftCards/giftCards.service';
import { walletRechargeService } from '@modules/wallet/walletRecharge.service';
import { paymentsService } from '../payments.service';

describe('PaymentsService webhook coupon attribution (F-18)', () => {
  afterEach(() => mock.restoreAll());

  it('records unequal per-coupon amounts from appliedCouponBreakdown on payment.captured', async (t) => {
    if (!env.RAZORPAY_WEBHOOK_SECRET) return t.skip('RAZORPAY_WEBHOOK_SECRET unset');

    const recorded: Array<{ couponId: string; discountApplied: number }> = [];
    const discountTotal = 145;
    const naiveSplit = discountTotal / 2;
    const breakdown = [
      { couponId: 'coupon-flat', discountApplied: 50 },
      { couponId: 'coupon-pct', discountApplied: 95 },
    ];

    mock.method(walletRechargeService, 'handlePaymentCaptured', async () => false);
    mock.method(giftCardsService, 'handlePaymentCaptured', async () => false);
    mock.method(WebhookEvent, 'findOrCreate', async () => [{}, true] as never);
    mock.method(sequelize, 'transaction', async (callback: (txn: { LOCK: { UPDATE: string } }) => Promise<unknown>) =>
      callback({ LOCK: { UPDATE: 'UPDATE' } }),
    );

    const order = {
      id: 'order-1',
      userId: 'user-1',
      paymentStatus: PAYMENT_STATUS.PENDING,
      appliedCouponIds: ['coupon-flat', 'coupon-pct'],
      couponId: null,
      appliedCouponBreakdown: breakdown,
      discountTotal,
      update: async function update(this: { paymentStatus: string }, fields: { paymentStatus?: string }) {
        if (fields.paymentStatus) this.paymentStatus = fields.paymentStatus;
        return this;
      },
    };
    mock.method(Order, 'findOne', async () => order as unknown as Order);
    mock.method(Coupon, 'findAll', async () => [
      { id: 'coupon-flat', code: 'FLAT50' },
      { id: 'coupon-pct', code: 'TENOFF' },
    ] as unknown as Coupon[]);
    mock.method(CouponUsage, 'findOne', async () => null);
    mock.method(CouponUsage, 'create', async (values: { couponId: string; discountApplied: number }) => {
      recorded.push({
        couponId: values.couponId,
        discountApplied: Number(values.discountApplied),
      });
      return values as unknown as CouponUsage;
    });
    mock.method(Coupon, 'increment', async () => [1] as never);

    const body = JSON.stringify({
      id: `evt_f18_${Date.now()}`,
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_f18',
            order_id: 'order_rzp_f18',
          },
        },
      },
    });
    const signature = crypto
      .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
      .update(body)
      .digest('hex');

    await paymentsService.handleRazorpayWebhook(body, signature);

    assert.deepEqual(recorded, [
      { couponId: 'coupon-flat', discountApplied: 50 },
      { couponId: 'coupon-pct', discountApplied: 95 },
    ]);
    assert.notEqual(recorded[0]?.discountApplied, naiveSplit);
    assert.notEqual(recorded[1]?.discountApplied, naiveSplit);
  });
});
