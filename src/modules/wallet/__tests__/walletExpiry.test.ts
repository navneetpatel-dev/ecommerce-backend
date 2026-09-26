import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promotionalExpiryDebitAmount } from '../walletExpiry';

describe('promotionalExpiryDebitAmount', () => {
  it('expires an expired lot that is still unused', () => {
    // ₹100 promo credited, now past its expiry, nothing spent.
    assert.equal(
      promotionalExpiryDebitAmount({ expiredLots: 100, promotionalCredits: 100, netPromotional: 100 }),
      100,
    );
  });

  it('expires only what is left of an expired lot after spending', () => {
    // ₹100 lot, ₹60 of it spent before expiry: ₹40 expires.
    assert.equal(
      promotionalExpiryDebitAmount({ expiredLots: 100, promotionalCredits: 100, netPromotional: 40 }),
      40,
    );
  });

  it('never re-expires a lot on a later run, so newer points are kept', () => {
    // ₹100 expired yesterday (already debited); ₹50 new cashback still valid.
    // Credits ₹150, balance ₹50: all ₹100 of the expired lot is used.
    assert.equal(
      promotionalExpiryDebitAmount({ expiredLots: 100, promotionalCredits: 150, netPromotional: 50 }),
      0,
    );
  });

  it('expires nothing when nothing expired or no promo is left', () => {
    assert.equal(
      promotionalExpiryDebitAmount({ expiredLots: 0, promotionalCredits: 100, netPromotional: 100 }),
      0,
    );
    assert.equal(
      promotionalExpiryDebitAmount({ expiredLots: 50, promotionalCredits: 50, netPromotional: 0 }),
      0,
    );
  });
});
