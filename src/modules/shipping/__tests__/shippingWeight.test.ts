import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeVendorShippingWeightGrams,
  DEFAULT_VARIANT_WEIGHT_GRAMS,
  lineWeightGramsFromParts,
} from '../shippingWeight';

describe('shippingWeight', () => {
  it('uses the default variant weight when weight is missing', () => {
    assert.equal(lineWeightGramsFromParts(2, null), 2 * DEFAULT_VARIANT_WEIGHT_GRAMS);
  });

  it('sums vendor cart line weights on the server', () => {
    const total = computeVendorShippingWeightGrams([
      { quantity: 2, variant: { weightGrams: 300 } },
      { quantity: 1, variant: { weightGrams: 500 } },
    ]);
    assert.equal(total, 1100);
  });
});
