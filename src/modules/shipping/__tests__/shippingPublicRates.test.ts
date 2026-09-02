import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Product } from '@database/models/product.model';
import { settingsService } from '@modules/settings/settings.service';
import { shippingService, type ShippingQuoteRate } from '../shipping.service';

describe('shippingService.quotePublicRates', () => {
  afterEach(() => mock.restoreAll());

  it('ignores client weight when product context is provided', async () => {
    mock.method(Product, 'scope', () => ({
      findByPk: async () => ({
        vendorId: 'vendor-1',
        basePrice: 500,
        variants: [{ id: 'variant-1', price: 500, weightGrams: 750 }],
      }),
    }) as ReturnType<typeof Product.scope>);
    mock.method(settingsService, 'getPlatformSettings', async () => ({
      freeShippingThreshold: 1_000,
    }) as Awaited<ReturnType<typeof settingsService.getPlatformSettings>>);

    let resolvedWeight: number | undefined;
    mock.method(shippingService, 'getRatesForQuote', async (params) => {
      resolvedWeight = params.weightGrams;
      return [{
        method: 'STANDARD',
        cost: 50,
        shippingDisplayKey: 'PAID',
        estimatedDays: 5,
        freeShippingThreshold: null,
        zoneId: 'zone-1',
      }] satisfies ShippingQuoteRate[];
    });

    const rates = await shippingService.quotePublicRates({
      pincode: '400001',
      productId: 'product-1',
      variantId: 'variant-1',
      vendorId: 'vendor-1',
      weight: 99_999,
    });

    assert.equal(resolvedWeight, 750);
    assert.equal(rates[0]?.shippingDisplayKey, 'PAID');
  });
});