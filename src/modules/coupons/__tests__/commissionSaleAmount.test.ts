import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DISCOUNT_BEARER } from '@core/constants/statuses';
import { commissionSaleAmount } from '../coupon.utils';

describe('commissionSaleAmount', () => {
  it('reduces sale amount when vendor bears the discount', () => {
    assert.equal(commissionSaleAmount(1000, 150, DISCOUNT_BEARER.VENDOR), 850);
  });

  it('keeps pre-discount sale amount when platform bears the discount', () => {
    assert.equal(commissionSaleAmount(1000, 150, DISCOUNT_BEARER.PLATFORM), 1000);
  });

  it('never returns a negative sale amount', () => {
    assert.equal(commissionSaleAmount(100, 250, DISCOUNT_BEARER.VENDOR), 0);
  });

  it('treats missing bearer as platform (no reduction)', () => {
    assert.equal(commissionSaleAmount(500, 50, null), 500);
    assert.equal(commissionSaleAmount(500, 50, undefined), 500);
  });
});
