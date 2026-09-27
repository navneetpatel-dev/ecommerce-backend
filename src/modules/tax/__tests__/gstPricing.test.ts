import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { taxService } from '@modules/tax/tax.service';
import {
  gstInclusiveValuePaise,
  preGstDiscountPaise,
  priceWithRuleGst,
  withGstInclusiveUnitPrices,
} from '@modules/tax/gstPricing';

const eighteen = { gstPercentage: 18, gstPriceBand: null };

describe('GST-inclusive pricing helpers', () => {
  afterEach(() => mock.restoreAll());

  it('prices a piece with GST, at the band rate above the band', () => {
    assert.equal(priceWithRuleGst(eighteen, 1000), 1180);
    const banded = { gstPercentage: 5, gstPriceBand: { thresholdPaise: 250_000, gstPercentageAbove: 18 } };
    assert.equal(priceWithRuleGst(banded, 2500), 2625);
    assert.equal(priceWithRuleGst(banded, 3000), 3540);
  });

  it("gives coupon lines the customer's prices, resolving each category's rule once", async () => {
    const lookup = mock.method(taxService, 'getGstRateRule', async (categoryId?: string) =>
      categoryId === 'books' ? { gstPercentage: 0, gstPriceBand: null } : eighteen,
    );
    const lines = await withGstInclusiveUnitPrices([
      { categoryId: 'shoes', unitPrice: 1000, quantity: 1 },
      { categoryId: 'shoes', unitPrice: 500, quantity: 2 },
      { categoryId: 'books', unitPrice: 300, quantity: 1 },
    ]);
    assert.deepEqual(
      lines.map((line) => line.unitPrice),
      [1180, 590, 300],
    );
    assert.equal(lookup.mock.callCount(), 2);
  });

  it('converts a GST-inclusive discount to the pre-GST discount that takes it off', () => {
    const lines = [{ unitPricePaise: 100_000, quantity: 1, gstPercentage: 18, gstPriceBand: null }];
    assert.equal(gstInclusiveValuePaise(lines), 118_000);
    // ₹100 off what the customer pays is ₹84.75 off the pre-GST price (₹84.75 + 18% ≈ ₹100).
    assert.equal(preGstDiscountPaise(10_000, lines), 8_475);
    // Mixed rates: spread by value, the GST each line carries comes off with it.
    const mixed = [
      { unitPricePaise: 100_000, quantity: 1, gstPercentage: 18, gstPriceBand: null },
      { unitPricePaise: 100_000, quantity: 1, gstPercentage: 5, gstPriceBand: null },
    ];
    // Items cost ₹2,230 with GST; ₹223 off (10%) is ₹200 off the ₹2,000 pre-GST.
    assert.equal(preGstDiscountPaise(22_300, mixed), 20_000);
    // Never more than the items themselves.
    assert.equal(preGstDiscountPaise(1_000_000, lines), 100_000);
    assert.equal(preGstDiscountPaise(0, lines), 0);
  });
});
