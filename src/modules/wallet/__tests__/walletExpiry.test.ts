import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promotionalExpiryDebitAmount } from '../walletExpiry';

describe('walletExpiry', () => {
  it('caps expiry debit at expired lots when net promo is higher', () => {
    assert.equal(promotionalExpiryDebitAmount(50, 90), 50);
  });

  it('caps expiry debit at net promo when expired lots exceed balance', () => {
    assert.equal(promotionalExpiryDebitAmount(80, 40), 40);
  });

  it('returns zero when nothing expired or no promo left', () => {
    assert.equal(promotionalExpiryDebitAmount(0, 100), 0);
    assert.equal(promotionalExpiryDebitAmount(50, 0), 0);
  });
});
