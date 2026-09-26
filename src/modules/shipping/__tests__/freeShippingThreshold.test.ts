import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Product } from '@database/models/product.model';
import { ShippingRate } from '@database/models/shippingRate.model';
import { settingsService } from '@modules/settings/settings.service';
import { shippingService } from '../shipping.service';
import { resolveVendorShippingQuote } from '../vendorShippingQuote';

type RateRow = { vendorId: string | null; method: string; price: number; freeShippingThreshold: number | null };

function mockPlatform(freeShippingThreshold: number | null) {
  mock.method(settingsService, 'getPlatformSettings', async () => ({
    freeShippingThreshold,
  }) as Awaited<ReturnType<typeof settingsService.getPlatformSettings>>);
}

function mockRates(rows: RateRow[]) {
  mock.method(shippingService, 'resolveZonesForPincode', async () => [{ id: 'zone-1' }] as never);
  mock.method(ShippingRate, 'findAll', async (options: { where?: { vendorId?: unknown } }) => {
    const where = options?.where ?? {};
    const filtered =
      'vendorId' in where ? rows.filter((row) => row.vendorId === where.vendorId) : rows;
    return filtered.map((row) => ({
      ...row,
      estimatedDays: 4,
      zoneId: 'zone-1',
    })) as never;
  });
}

describe('free-shipping threshold: one definition for product page, cart and checkout', () => {
  afterEach(() => mock.restoreAll());

  it('a rate without its own threshold uses the platform threshold', async () => {
    mockPlatform(500);
    mockRates([{ vendorId: 'vendor-1', method: 'STANDARD', price: 60, freeShippingThreshold: null }]);
    const [rate] = await shippingService.getRatesForQuote({
      pincode: '400001',
      weightGrams: 500,
      vendorId: 'vendor-1',
    });
    assert.equal(rate?.freeShippingThreshold, 500);
  });

  it('checkout charges what the product page showed: free above the platform threshold', async () => {
    mockPlatform(500);
    mockRates([{ vendorId: 'vendor-1', method: 'STANDARD', price: 60, freeShippingThreshold: null }]);
    mock.method(Product, 'scope', () => ({
      findByPk: async () => ({
        vendorId: 'vendor-1',
        basePrice: 600,
        variants: [{ id: 'variant-1', price: 600, weightGrams: 500 }],
      }),
    }) as ReturnType<typeof Product.scope>);

    const [pdp] = await shippingService.quotePublicRates({
      pincode: '400001',
      productId: 'product-1',
      variantId: 'variant-1',
      vendorId: 'vendor-1',
    });
    const checkout = await resolveVendorShippingQuote({
      destination: { pincode: '400001' },
      vendorId: 'vendor-1',
      method: 'STANDARD',
      lines: [{ unitPrice: 600, quantity: 1, weightGrams: 500 }],
    });
    // Both free: the ₹600 order is above the ₹500 platform threshold. Checkout used to
    // charge ₹60 here while the product page said free.
    assert.equal(pdp?.cost, 0);
    assert.equal(checkout.shippingCost, 0);
  });

  it("the vendor badge promises the highest of the vendor's thresholds, not the lowest", async () => {
    mockPlatform(500);
    mockRates([
      { vendorId: 'vendor-1', method: 'STANDARD', price: 60, freeShippingThreshold: 300 },
      { vendorId: 'vendor-1', method: 'EXPRESS', price: 90, freeShippingThreshold: 900 },
      { vendorId: 'vendor-1', method: 'STANDARD', price: 70, freeShippingThreshold: null },
    ]);
    assert.equal(await shippingService.getVendorFreeShippingThreshold('vendor-1'), 900);
  });

  it('no badge when a rate that applies is never free', async () => {
    mockPlatform(null);
    mockRates([
      { vendorId: 'vendor-1', method: 'STANDARD', price: 60, freeShippingThreshold: 300 },
      { vendorId: 'vendor-1', method: 'STANDARD', price: 70, freeShippingThreshold: null },
    ]);
    assert.equal(await shippingService.getVendorFreeShippingThreshold('vendor-1'), null);
  });

  it('a platform product (or a vendor without rates) uses the platform-wide rates', async () => {
    mockPlatform(500);
    mockRates([{ vendorId: null, method: 'STANDARD', price: 60, freeShippingThreshold: 700 }]);
    assert.equal(await shippingService.getVendorFreeShippingThreshold(null), 700);
    assert.equal(await shippingService.getVendorFreeShippingThreshold('vendor-2'), 700);
  });
});
