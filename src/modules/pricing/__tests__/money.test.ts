import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { coerceRupees, fromPaise, roundMoney, toPaise } from '../money';

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
});
