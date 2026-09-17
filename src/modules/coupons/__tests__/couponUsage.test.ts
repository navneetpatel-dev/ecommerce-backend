import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it, mock } from 'node:test';
import { Coupon } from '@database/models/coupon.model';
import { CouponUsage } from '@database/models/couponUsage.model';
import {
  breakdownFromPerCoupon,
  discountAppliedFromBreakdown,
  recordCouponUsagesForOrder,
} from '../couponEngine';

function sourceOf(relativeFromThisFile: string) {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), relativeFromThisFile), 'utf8');
}

describe('coupon usage attribution (F-18)', () => {
  afterEach(() => mock.restoreAll());

  const perCoupon = [
    {
      code: 'FLAT50',
      type: 'FLAT',
      discount: 50,
      cashbackAmount: 0,
      freeShipping: false,
    },
    {
      code: 'TENOFF',
      type: 'PERCENT',
      discount: 95,
      cashbackAmount: 0,
      freeShipping: false,
    },
  ];
  const coupons = [
    { id: 'coupon-flat', code: 'FLAT50' },
    { id: 'coupon-pct', code: 'TENOFF' },
  ];
  const discountTotal = 145;
  const naiveSplit = discountTotal / 2;

  it('maps per-coupon discounts onto coupon ids without equal-splitting', () => {
    const breakdown = breakdownFromPerCoupon(perCoupon, coupons);

    assert.deepEqual(breakdown, [
      { couponId: 'coupon-flat', discountApplied: 50 },
      { couponId: 'coupon-pct', discountApplied: 95 },
    ]);
    assert.notEqual(breakdown[0]?.discountApplied, naiveSplit);
    assert.notEqual(breakdown[1]?.discountApplied, naiveSplit);

    assert.equal(
      discountAppliedFromBreakdown('coupon-flat', breakdown, naiveSplit),
      50,
    );
    assert.equal(
      discountAppliedFromBreakdown('coupon-pct', breakdown, naiveSplit),
      95,
    );
  });

  it('falls back to an equal share only when the persisted breakdown is missing', () => {
    assert.equal(
      discountAppliedFromBreakdown('coupon-flat', [], naiveSplit),
      naiveSplit,
    );
  });

  it('records each CouponUsage.discountApplied from the breakdown, not discountTotal / n', async () => {
    const recorded: Array<{ couponId: string; discountApplied: number }> = [];

    mock.method(CouponUsage, 'findOne', async () => null);
    mock.method(CouponUsage, 'create', async (values: { couponId: string; discountApplied: number }) => {
      recorded.push({
        couponId: values.couponId,
        discountApplied: values.discountApplied,
      });
      return values as unknown as CouponUsage;
    });
    mock.method(Coupon, 'increment', async () => [1] as never);

    const breakdown = breakdownFromPerCoupon(perCoupon, coupons);
    await recordCouponUsagesForOrder({
      coupons,
      breakdown,
      discountTotal,
      userId: 'user-1',
      orderId: 'order-1',
      actorId: 'user-1',
    });

    assert.deepEqual(recorded, [
      { couponId: 'coupon-flat', discountApplied: 50 },
      { couponId: 'coupon-pct', discountApplied: 95 },
    ]);
    assert.notEqual(recorded[0]?.discountApplied, naiveSplit);
  });

  it('records the persisted breakdown at the checkout wallet-paid, checkout COD, and payments capture call shapes', async () => {
    const breakdown = breakdownFromPerCoupon(perCoupon, coupons);
    const naive = discountTotal / coupons.length;

    async function recordAt(site: 'checkout-wallet' | 'checkout-cod' | 'payments-capture') {
      const recorded: Array<{ couponId: string; discountApplied: number }> = [];
      mock.restoreAll();
      mock.method(CouponUsage, 'findOne', async () => null);
      mock.method(CouponUsage, 'create', async (values: { couponId: string; discountApplied: number }) => {
        recorded.push({
          couponId: values.couponId,
          discountApplied: Number(values.discountApplied),
        });
        return values as unknown as CouponUsage;
      });
      mock.method(Coupon, 'increment', async () => [1] as never);

      const order = {
        appliedCouponBreakdown: breakdown,
        discountTotal,
      };
      const callBreakdown =
        site === 'payments-capture'
          ? (Array.isArray(order.appliedCouponBreakdown) ? order.appliedCouponBreakdown : [])
          : breakdown;

      await recordCouponUsagesForOrder({
        coupons,
        breakdown: callBreakdown,
        discountTotal,
        userId: 'user-1',
        orderId: `order-${site}`,
        actorId: 'user-1',
      });

      assert.deepEqual(recorded, [
        { couponId: 'coupon-flat', discountApplied: 50 },
        { couponId: 'coupon-pct', discountApplied: 95 },
      ]);
      assert.notEqual(recorded[0]?.discountApplied, naive);
      assert.notEqual(recorded[1]?.discountApplied, naive);
    }

    await recordAt('checkout-wallet');
    await recordAt('checkout-cod');
    await recordAt('payments-capture');
  });

  it('checkout wallet-paid and COD sites pass appliedCouponBreakdown, not discountTotal / n', () => {
    const src = sourceOf('../../checkout/checkout.service.ts');
    const usageCalls = src.match(/recordCouponUsagesForOrder\(/g) ?? [];
    const breakdownPasses = src.match(/breakdown:\s*appliedCouponBreakdown/g) ?? [];
    assert.equal(usageCalls.length, 2);
    assert.equal(breakdownPasses.length, 2);
    assert.doesNotMatch(src, /discountTotal\s*\/\s*coupons\.length/);
  });

  it('payments capture reads order.appliedCouponBreakdown instead of an equal split', () => {
    const src = sourceOf('../../payments/payments.service.ts');
    const start = src.indexOf('applyCouponOnPaymentCaptured');
    assert.ok(start >= 0);
    const body = src.slice(start, src.indexOf('getOrCreateCustomerId', start));
    assert.match(body, /order\.appliedCouponBreakdown/);
    assert.match(body, /recordCouponUsagesForOrder/);
    assert.doesNotMatch(body, /discountTotal\s*\/\s*coupons\.length/);
  });
});
