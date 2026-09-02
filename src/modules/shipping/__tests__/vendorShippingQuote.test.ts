import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { shippingService } from '../shipping.service';
import { resolveVendorShippingQuote } from '../vendorShippingQuote';

describe('resolveVendorShippingQuote', () => {
  afterEach(() => mock.restoreAll());

  it('uses server line weights and applies the free-shipping threshold', async () => {
    let queriedWeight: number | undefined;
    mock.method(shippingService, 'getRatesForQuote', async (params) => {
      queriedWeight = params.weightGrams;
      return [
        {
          method: 'STANDARD',
          cost: 75,
          shippingDisplayKey: 'PAID',
          estimatedDays: 4,
          freeShippingThreshold: 500,
          zoneId: 'zone-1',
        },
      ];
    });

    const quote = await resolveVendorShippingQuote({
      destination: { pincode: '400001', state: 'Maharashtra' },
      vendorId: 'vendor-1',
      method: 'STANDARD',
      lines: [
        { unitPrice: 200, quantity: 2, weightGrams: 300 },
        { unitPrice: 100, quantity: 1, weightGrams: 700 },
      ],
    });

    assert.equal(queriedWeight, 1_300);
    assert.equal(quote.subtotal, 500);
    assert.equal(quote.shippingCost, 0);
    assert.equal(quote.shippingDisplayKey, 'FREE');
  });

  it('does not query rates without a destination', async () => {
    const getRates = mock.method(shippingService, 'getRatesForQuote');
    const quote = await resolveVendorShippingQuote({
      destination: null,
      vendorId: 'vendor-1',
      method: 'STANDARD',
      lines: [{ unitPrice: 100, quantity: 1, weightGrams: 250 }],
    });

    assert.equal(getRates.mock.callCount(), 0);
    assert.equal(quote.rate, null);
    assert.equal(quote.shippingCost, 0);
  });
});
