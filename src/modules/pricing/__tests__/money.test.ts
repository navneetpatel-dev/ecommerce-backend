import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { coerceRupees, fromPaise, roundMoney, sumRupees, toPaise } from '../money';

describe('pricing money', () => {
  it('coerces Sequelize DECIMAL strings without changing stored value', () => {
    assert.equal(coerceRupees('2364.16'), 2364.16);
    assert.equal(coerceRupees('310516.87'), 310516.87);
    assert.equal(coerceRupees(null), 0);
    assert.equal(coerceRupees(undefined), 0);
  });

  it('roundMoney preserves DECIMAL strings through the paise round-trip', () => {
    assert.equal(roundMoney('2364.16'), 2364.16);
    assert.equal(roundMoney('310516.87'), 310516.87);
    assert.equal(roundMoney('0.00'), 0);
  });

  it('keeps toPaise/fromPaise stable for stored rupee amounts', () => {
    assert.equal(fromPaise(toPaise('1847.00')), 1847);
    assert.equal(fromPaise(toPaise('517.16')), 517.16);
  });

  it('sums rupee amounts exactly in paise', () => {
    // A plain float sum gives 0.30000000000000004, so "collected − deposited > 0"
    // wrongly reported cash still owed.
    assert.equal(sumRupees([0.1, 0.2]), 0.3);
    assert.equal(sumRupees([0.1, 0.2]) - 0.3, 0);
    assert.equal(sumRupees(['10.20', '10.20', '10.20']), 30.6);
    assert.equal(sumRupees(['-5.05', 5.05]), 0);
  });

  it('treats missing values as nothing to add', () => {
    assert.equal(sumRupees([]), 0);
    assert.equal(sumRupees([null, undefined, '12.50']), 12.5);
  });
});
