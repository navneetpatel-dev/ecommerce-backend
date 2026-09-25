import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PAYMENT_METHOD } from '@core/constants/statuses';
import {
  isWalletFundedOrder,
  orderCheckoutTotalPaise,
  orderRazorpayPaidPaise,
  walletShareOfRefundPaise,
} from '../refundSplit';

const split = {
  originalTotalAmount: '1000.00',
  totalAmount: '600.00', // reduced by an earlier return
  razorpayAmountPaid: '750.00',
  walletAmountUsed: '250.00',
  razorpayPaymentId: 'pay_1',
  paymentMethod: PAYMENT_METHOD.RAZORPAY,
};

describe('orderCheckoutTotalPaise', () => {
  it('uses the frozen checkout total, not the total returns have reduced', () => {
    assert.equal(orderCheckoutTotalPaise(split), 100000);
  });

  it('never goes below what was actually paid, for rows without the frozen total', () => {
    assert.equal(
      orderCheckoutTotalPaise({ totalAmount: '500.00', razorpayAmountPaid: '450.00', walletAmountUsed: '100.00' }),
      55000,
    );
  });
});

describe('orderRazorpayPaidPaise', () => {
  it('reads the stored amount, keeping a real zero', () => {
    assert.equal(orderRazorpayPaidPaise(split), 75000);
    assert.equal(orderRazorpayPaidPaise({ ...split, razorpayAmountPaid: 0 }), 0);
  });

  it('falls back to checkout total less wallet when never stored', () => {
    assert.equal(orderRazorpayPaidPaise({ ...split, razorpayAmountPaid: null }), 75000);
  });
});

describe('isWalletFundedOrder', () => {
  it('is true for wallet-only checkouts and when the wallet covers the total', () => {
    assert.equal(
      isWalletFundedOrder({ walletAmountUsed: 300, razorpayAmountPaid: 0, totalAmount: 300 }),
      true,
    );
    assert.equal(
      isWalletFundedOrder({ ...split, walletAmountUsed: '1000.00', razorpayAmountPaid: 0 }),
      true,
    );
  });

  it('is false for split payments, no-wallet orders and COD', () => {
    assert.equal(isWalletFundedOrder(split), false);
    assert.equal(isWalletFundedOrder({ ...split, walletAmountUsed: 0 }), false);
    assert.equal(
      isWalletFundedOrder({
        walletAmountUsed: 100,
        razorpayAmountPaid: 0,
        totalAmount: 400,
        paymentMethod: PAYMENT_METHOD.COD,
      }),
      false,
    );
  });
});

describe('walletShareOfRefundPaise', () => {
  it("is the refund's share of the checkout total that the wallet paid", () => {
    // Wallet paid 25% of ₹1,000: a ₹200 refund returns ₹50 to the wallet.
    assert.equal(walletShareOfRefundPaise(split, 20000), 5000);
    // Rounded in paise: 25% of ₹0.33.
    assert.equal(walletShareOfRefundPaise(split, 33), 8);
  });

  it('is zero without a wallet part or a refund', () => {
    assert.equal(walletShareOfRefundPaise({ ...split, walletAmountUsed: 0 }, 20000), 0);
    assert.equal(walletShareOfRefundPaise(split, 0), 0);
  });
});
