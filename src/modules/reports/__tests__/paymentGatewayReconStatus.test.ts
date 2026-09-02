import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PAYMENT_METHOD, PAYMENT_STATUS } from '@core/constants/statuses';
import { resolvePaymentGatewayReconStatus } from '../paymentGatewayReconStatus';

describe('resolvePaymentGatewayReconStatus', () => {
  it('marks full-wallet PAID orders without PG payment id as WALLET_SETTLED', () => {
    assert.equal(
      resolvePaymentGatewayReconStatus({
        paymentMethod: PAYMENT_METHOD.RAZORPAY,
        paymentStatus: PAYMENT_STATUS.PAID,
        razorpayPaymentId: null,
        razorpayAmountPaid: 0,
        walletAmountUsed: 500,
        totalAmount: 500,
      }),
      'WALLET_SETTLED',
    );
  });

  it('marks wallet-covered PAID orders as WALLET_SETTLED even if razorpayAmountPaid is stale', () => {
    assert.equal(
      resolvePaymentGatewayReconStatus({
        paymentMethod: PAYMENT_METHOD.RAZORPAY,
        paymentStatus: PAYMENT_STATUS.PAID,
        razorpayPaymentId: null,
        razorpayAmountPaid: 0.5,
        walletAmountUsed: 100,
        totalAmount: 100,
      }),
      'WALLET_SETTLED',
    );
  });

  it('keeps MISSING_PG_REF when a non-zero Razorpay remainder was expected', () => {
    assert.equal(
      resolvePaymentGatewayReconStatus({
        paymentMethod: PAYMENT_METHOD.RAZORPAY,
        paymentStatus: PAYMENT_STATUS.PAID,
        razorpayPaymentId: null,
        razorpayAmountPaid: 200,
        walletAmountUsed: 50,
        totalAmount: 250,
      }),
      'MISSING_PG_REF',
    );
  });

  it('matches when razorpayPaymentId is present', () => {
    assert.equal(
      resolvePaymentGatewayReconStatus({
        paymentMethod: PAYMENT_METHOD.RAZORPAY,
        paymentStatus: PAYMENT_STATUS.PAID,
        razorpayPaymentId: 'pay_abc',
        razorpayAmountPaid: 200,
        walletAmountUsed: 50,
        totalAmount: 250,
      }),
      'MATCHED',
    );
  });

  it('marks anomalous PAID orders with zero wallet and zero PG paid as REVIEW', () => {
    assert.equal(
      resolvePaymentGatewayReconStatus({
        paymentMethod: PAYMENT_METHOD.RAZORPAY,
        paymentStatus: PAYMENT_STATUS.PAID,
        razorpayPaymentId: null,
        razorpayAmountPaid: 0,
        walletAmountUsed: 0,
        totalAmount: 500,
      }),
      'REVIEW',
    );
  });
});
