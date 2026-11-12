import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { priceChangeFor } from '../cartPriceChange';

const withGst = (price: number) => Math.round(price * 1.18 * 100) / 100;

describe('priceChangeFor (B-55)', () => {
  it('reports a drop with the old price as the shopper saw it', () => {
    assert.deepEqual(priceChangeFor('500.00', 450, withGst), { direction: 'DOWN', previousDisplayPrice: 590 });
  });

  it('reports a rise', () => {
    assert.equal(priceChangeFor(400, 450, withGst)?.direction, 'UP');
  });

  it('says nothing when the price is the same or was never recorded', () => {
    assert.equal(priceChangeFor('450.00', 450, withGst), null);
    assert.equal(priceChangeFor(null, 450, withGst), null);
    assert.equal(priceChangeFor('', 450, withGst), null);
  });
});
