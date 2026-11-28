import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { minOrderShortfallMessage, minQuantityShortfallMessage } from '../couponErrors';

describe('U13: a minimum-order coupon says what it takes', () => {
  it('names the gap and the minimum', () => {
    assert.equal(
      minOrderShortfallMessage(2000, 1180),
      'Add ₹820.00 more to use this coupon (minimum order ₹2,000.00)',
    );
  });
  it('counts items for a minimum quantity', () => {
    assert.equal(minQuantityShortfallMessage(2, 1), 'Add 1 more item to use this coupon (minimum 2)');
    assert.equal(minQuantityShortfallMessage(5, 2), 'Add 3 more items to use this coupon (minimum 5)');
  });
});
