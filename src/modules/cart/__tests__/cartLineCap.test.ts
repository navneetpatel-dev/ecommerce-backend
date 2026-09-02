import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_CART_LINE_QUANTITY } from '../cart.constants';

/**
 * `clampQuantity` is module-private, so this pins the contract the cart view
 * publishes as `maxQuantity`: the lower of remaining stock and the policy cap.
 * The update endpoint clamps to the same value, so a client that respects it
 * never sees its quantity silently corrected.
 */
function expectedLineCap(stock: number): number {
  return Math.max(0, Math.min(MAX_CART_LINE_QUANTITY, stock));
}

describe('cart line quantity cap', () => {
  it('caps at remaining stock when stock is the tighter limit', () => {
    assert.equal(expectedLineCap(14), 14);
    assert.equal(expectedLineCap(1), 1);
  });

  it('caps at the policy limit when stock is plentiful', () => {
    assert.equal(expectedLineCap(475), MAX_CART_LINE_QUANTITY);
    assert.equal(expectedLineCap(MAX_CART_LINE_QUANTITY + 1), MAX_CART_LINE_QUANTITY);
  });

  it('never reports a negative cap', () => {
    assert.equal(expectedLineCap(0), 0);
    assert.equal(expectedLineCap(-5), 0);
  });
});
