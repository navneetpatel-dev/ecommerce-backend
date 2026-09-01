import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checkWalletRechargeAmountRange,
  walletRechargeAmountRangeMessage,
} from '../walletRechargeAmount.validation';

describe('walletRechargeAmount.validation', () => {
  const limits = { minInr: 1, maxInr: 10000 };

  it('flags amounts below minimum', () => {
    assert.equal(checkWalletRechargeAmountRange(0, limits), 'below-min');
  });

  it('flags amounts above maximum', () => {
    assert.equal(checkWalletRechargeAmountRange(1000000, limits), 'above-max');
  });

  it('accepts amounts within range', () => {
    assert.equal(checkWalletRechargeAmountRange(500, limits), null);
  });

  it('returns descriptive below-min message', () => {
    assert.match(
      walletRechargeAmountRangeMessage('below-min', limits),
      /at least ₹1/,
    );
  });

  it('returns descriptive above-max message', () => {
    assert.match(
      walletRechargeAmountRangeMessage('above-max', limits),
      /cannot exceed ₹10,000/,
    );
  });
});
