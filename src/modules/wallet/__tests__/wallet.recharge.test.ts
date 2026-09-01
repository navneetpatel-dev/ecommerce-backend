import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCreateWalletRechargeSchema,
  CreateWalletRechargeSchema,
  VerifyWalletRechargeSchema,
} from '../walletRecharge.dto';

describe('CreateWalletRechargeSchema', () => {
  it('accepts positive recharge amounts within default limits', () => {
    const parsed = CreateWalletRechargeSchema.parse({ amountInr: 500 });
    assert.equal(parsed.amountInr, 500);
  });

  it('rejects non-positive amounts', () => {
    assert.throws(() => CreateWalletRechargeSchema.parse({ amountInr: 0 }));
  });

  it('rejects amount below minimum', () => {
    assert.throws(
      () => CreateWalletRechargeSchema.parse({ amountInr: 0 }),
      /at least ₹1/,
    );
  });

  it('rejects amount above maximum', () => {
    assert.throws(
      () => CreateWalletRechargeSchema.parse({ amountInr: 20000 }),
      /cannot exceed ₹10,000/,
    );
  });

  it('uses configured platform limits', () => {
    const schema = buildCreateWalletRechargeSchema({ minInr: 250, maxInr: 5000 });
    assert.throws(
      () => schema.parse({ amountInr: 100 }),
      /at least ₹250/,
    );
  });
});

describe('VerifyWalletRechargeSchema', () => {
  it('normalizes snake_case Razorpay fields', () => {
    const parsed = VerifyWalletRechargeSchema.parse({
      razorpay_order_id: 'order_1',
      razorpay_payment_id: 'pay_1',
      razorpay_signature: 'sig_1',
      rechargeId: '00000000-0000-4000-8000-000000000001',
    });
    assert.equal(parsed.razorpayOrderId, 'order_1');
    assert.equal(parsed.razorpayPaymentId, 'pay_1');
    assert.equal(parsed.razorpaySignature, 'sig_1');
  });

  it('requires all Razorpay payment fields', () => {
    assert.throws(() =>
      VerifyWalletRechargeSchema.parse({
        razorpay_order_id: 'order_1',
      }),
    );
  });
});
