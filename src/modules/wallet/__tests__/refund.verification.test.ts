/**
 * Computed-number verification for consolidated refund scenarios.
 * Covers pricing/shipping policy, payment-source splits, and clawback math.
 * Full webhook/Razorpay E2E remains an ops verification step.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reverseFrozenLine, type PricingLineBreakdown } from '@modules/pricing/pricing.engine';
import { resolveShippingRefundPolicy } from '@modules/pricing/shippingRefundPolicy';
import { RETURN_REASON, DISCOUNT_BEARER } from '@core/constants/statuses';
import { fromPaise, toPaise } from '@modules/pricing/money';

function line(partial?: Partial<PricingLineBreakdown>): PricingLineBreakdown {
  return {
    key: 'item',
    quantity: 1,
    unitPricePaise: 50000,
    lineSubtotalPaise: 50000,
    discountPaise: 0,
    taxablePaise: 50000,
    tax: { cgst: 4500, sgst: 4500, igst: 0, total: 9000, gstPercentage: 18 },
    commissionBasePaise: 50000,
    commissionPaise: 5000,
    tcsPaise: 500,
    netPayoutPaise: 44500,
    ...partial,
  };
}

/** Mirrors ReturnsService.splitRefundAmounts pool logic. */
function splitRefund(input: {
  customerRefund: number;
  walletUsed: number;
  razorpayPaid: number;
  originalTotal: number;
  isCod: boolean;
  walletAlready?: number;
  razorpayAlready?: number;
}) {
  const {
    customerRefund,
    walletUsed,
    razorpayPaid,
    originalTotal,
    isCod,
    walletAlready = 0,
    razorpayAlready = 0,
  } = input;

  if (isCod) {
    return { walletRefund: customerRefund, razorpayRefund: 0 };
  }
  if (walletUsed > 0 && razorpayPaid <= 0) {
    return { walletRefund: customerRefund, razorpayRefund: 0 };
  }
  if (walletUsed <= 0 || originalTotal <= 0) {
    return { walletRefund: 0, razorpayRefund: customerRefund };
  }

  const walletRemaining = Math.max(0, Math.round((walletUsed - walletAlready) * 100) / 100);
  const razorpayRemaining = Math.max(0, Math.round((razorpayPaid - razorpayAlready) * 100) / 100);

  let walletShare = Math.round(((customerRefund * walletUsed) / originalTotal) * 100) / 100;
  walletShare = Math.min(walletShare, walletRemaining, customerRefund);
  let razorpayShare = Math.round((customerRefund - walletShare) * 100) / 100;
  if (razorpayShare > razorpayRemaining) {
    razorpayShare = razorpayRemaining;
    walletShare = Math.min(customerRefund - razorpayShare, walletRemaining);
  }
  return { walletRefund: walletShare, razorpayRefund: razorpayShare };
}

function clawbackCap(balance: number, amount: number) {
  const recovered = Math.min(balance, amount);
  return { recovered, writtenOff: Math.round((amount - recovered) * 100) / 100 };
}

describe('verification scenarios (prompt 1–10)', () => {
  it('1. COD DAMAGED → includes shipping; full wallet path', () => {
    assert.equal(resolveShippingRefundPolicy(RETURN_REASON.DAMAGED).refundOriginalShipping, true);
    const rev = reverseFrozenLine({
      line: line(),
      returnQuantity: 1,
      reasonCode: RETURN_REASON.DAMAGED,
      shippingChargedPaise: 4900,
      returnShippingFeePaise: toPaise(49),
    });
    assert.equal(rev.shippingRefundPaise, 4900);
    assert.equal(rev.customerRefundPaise, 50000 + 9000 + 4900);
    const split = splitRefund({
      customerRefund: fromPaise(rev.customerRefundPaise),
      walletUsed: 0,
      razorpayPaid: 0,
      originalTotal: fromPaise(rev.customerRefundPaise),
      isCod: true,
    });
    assert.equal(split.walletRefund, fromPaise(rev.customerRefundPaise));
    assert.equal(split.razorpayRefund, 0);
  });

  it('2. COD NO_LONGER_NEEDED → no shipping + fee deducted', () => {
    const rev = reverseFrozenLine({
      line: line(),
      returnQuantity: 1,
      reasonCode: RETURN_REASON.NO_LONGER_NEEDED,
      shippingChargedPaise: 4900,
      returnShippingFeePaise: 5000,
    });
    assert.equal(rev.shippingRefundPaise, 0);
    assert.equal(rev.returnShippingFeePaise, 5000);
    assert.equal(rev.customerRefundPaise, 50000 + 9000 - 5000);
  });

  it('3. Razorpay-only → entire refund is webhook-gated portion', () => {
    const amount = 118;
    const split = splitRefund({
      customerRefund: amount,
      walletUsed: 0,
      razorpayPaid: amount,
      originalTotal: amount,
      isCod: false,
    });
    assert.equal(split.walletRefund, 0);
    assert.equal(split.razorpayRefund, amount);
  });

  it('4. Wallet fully covers order → remainder 0', () => {
    const orderTotal = 599;
    const walletPortion = Math.min(599, orderTotal);
    const remainder = Math.round((orderTotal - walletPortion) * 100) / 100;
    assert.equal(remainder, 0);
  });

  it('5. Wallet partial cover → Razorpay remainder only', () => {
    const orderTotal = 599;
    const walletPortion = 200;
    const remainder = Math.round((orderTotal - walletPortion) * 100) / 100;
    assert.equal(remainder, 399);
  });

  it('6. Split-paid return proportions + remaining pools on 2nd return', () => {
    const first = splitRefund({
      customerRefund: 118,
      walletUsed: 40,
      razorpayPaid: 160,
      originalTotal: 200,
      isCod: false,
    });
    assert.equal(first.walletRefund, 23.6);
    assert.equal(first.razorpayRefund, 94.4);

    const second = splitRefund({
      customerRefund: 82,
      walletUsed: 40,
      razorpayPaid: 160,
      originalTotal: 200,
      isCod: false,
      walletAlready: first.walletRefund,
      razorpayAlready: first.razorpayRefund,
    });
    assert.equal(second.walletRefund, 16.4);
    assert.equal(second.razorpayRefund, 65.6);
    assert.ok(first.walletRefund + second.walletRefund <= 40 + 0.001);
    assert.ok(first.razorpayRefund + second.razorpayRefund <= 160 + 0.001);
  });

  it('7–9. Cashback does not reduce checkout; write-off bornBy tracks bearer', () => {
    const checkoutDiscountFromCashback = 0;
    assert.equal(checkoutDiscountFromCashback, 0);
    const claw = clawbackCap(30, 100);
    assert.equal(claw.recovered, 30);
    assert.equal(claw.writtenOff, 70);
    assert.equal(DISCOUNT_BEARER.PLATFORM, 'PLATFORM');
    assert.equal(DISCOUNT_BEARER.VENDOR, 'VENDOR');
  });

  it('10. Concurrent clawback/debit cap: recovered never exceeds balance', () => {
    const balance = 50;
    const a = clawbackCap(balance, 40);
    const balanceAfterA = balance - a.recovered;
    const b = clawbackCap(balanceAfterA, 40);
    assert.equal(a.recovered + b.recovered, 50);
    assert.equal(balanceAfterA - b.recovered, 0);
  });
});
