import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertStockFor } from '../cartStock';

describe('adding more than the stock (B-35)', () => {
  it('says the item is sold out, with nothing left', () => {
    assert.throws(() => assertStockFor(1, 0), { statusCode: 409, code: 'OUT_OF_STOCK' });
  });

  it('says how many are left when asked for more', () => {
    assert.throws(() => assertStockFor(500, 61), (err: { statusCode: number; message: string; details: { available: number } }) =>
      err.statusCode === 409 && err.message === 'Only 61 left in stock' && err.details.available === 61);
  });

  it('lets a quantity within stock through', () => {
    assert.doesNotThrow(() => assertStockFor(3, 61));
  });
});
