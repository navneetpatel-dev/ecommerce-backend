import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import type { Product } from '@database/models/product.model';
import { Product as ProductModel } from '@database/models/product.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { taxService } from '@modules/tax/tax.service';
import {
  gstRuleResolver,
  mapProductResponse,
  pdpDisplayPricing,
  priceWithRuleGst,
  productDisplayPrice,
  syncProductBasePrice,
} from '../products.service';

describe('product MRP discount follows the variant', () => {
  const policy = { gstPercentage: 5, gstPriceBand: null };

  it("gives each variant its own discount against the product's MRP, GST included", () => {
    // MRP ₹1,500 includes GST; the prices are before GST (5%).
    const base = pdpDisplayPricing(policy, 1000, 1500);
    assert.equal(base.displayPrice, 1050);
    // ₹1,050 against ₹1,500 is 30% off, not the 33% the pre-GST ₹1,000 would claim.
    assert.equal(base.discountPercent, 30);
    const dearer = pdpDisplayPricing(policy, 1400, 1500);
    assert.equal(dearer.displayPrice, 1470);
    assert.equal(dearer.discountPercent, 2);
    assert.equal(dearer.showMrp, true);
    // ₹1,450 before GST is ₹1,522.50 with it: above the MRP, so no discount.
    const aboveMrp = pdpDisplayPricing(policy, 1450, 1500);
    assert.equal(aboveMrp.displayPrice, 1522.5);
    assert.equal(aboveMrp.discountPercent, null);
    assert.equal(aboveMrp.showMrp, false);
  });

  it('adds GST at the band rate for a piece above the band', () => {
    const banded = { gstPercentage: 5, gstPriceBand: { thresholdPaise: 250_000, gstPercentageAbove: 18 } };
    assert.equal(pdpDisplayPricing(banded, 2500, null).displayPrice, 2625);
    assert.equal(pdpDisplayPricing(banded, 3000, null).displayPrice, 3540);
  });

  it("measures the product card's discount against its GST-inclusive price", () => {
    const product = {
      get: () => ({
        id: 'product-1',
        basePrice: 1000,
        displayPrice: 1050,
        compareAtPrice: 1500,
        images: [],
        variants: [],
      }),
    } as unknown as Product;
    const mapped = mapProductResponse(product);
    assert.equal(mapped.displayPrice, 1050);
    assert.equal(mapped.discountPercent, 30);
    assert.equal(mapped.showMrp, true);
  });
});

describe('product price range', () => {
  it('flags a range when variants sell at different prices', () => {
    const product = {
      get: () => ({
        id: 'p',
        basePrice: 499,
        compareAtPrice: null,
        images: [],
        variants: [
          { id: 'a', price: 499, stock: 1 },
          { id: 'b', price: 699, stock: 1 },
        ],
      }),
    } as unknown as Product;
    const mapped = mapProductResponse(product);
    assert.equal(mapped.hasPriceRange, true);
    assert.equal(mapped.priceRangeMax, 699);
  });

  it('shows a single price when every variant costs the same', () => {
    const product = {
      get: () => ({
        id: 'p',
        basePrice: 499,
        images: [],
        variants: [
          { id: 'a', price: 499, stock: 1 },
          { id: 'b', price: 499, stock: 1 },
        ],
      }),
    } as unknown as Product;
    assert.equal(mapProductResponse(product).hasPriceRange, false);
  });
});

describe('syncProductBasePrice', () => {
  afterEach(() => mock.restoreAll());

  function stubProduct(values: Record<string, unknown>) {
    const updates: Array<Record<string, unknown>> = [];
    const product = {
      ...values,
      update: async (next: Record<string, unknown>) => {
        updates.push(next);
        Object.assign(product, next);
      },
    };
    mock.method(ProductModel, 'findByPk', async () => product as never);
    mock.method(taxService, 'getGstRateRule', async () => ({ gstPercentage: 18, gstPriceBand: null }));
    return updates;
  }

  it("sets the product's listed price to its lowest variant price, and its GST-inclusive price", async () => {
    mock.method(ProductVariant, 'min', async () => 549 as never);
    const updates = stubProduct({ id: 'p', categoryId: 'c', basePrice: 499, displayPrice: 588.82 });
    await syncProductBasePrice('p', {} as never);
    assert.deepEqual(updates, [{ basePrice: 549 }, { displayPrice: 647.82 }]);
  });

  it('leaves a product without variants on its own price', async () => {
    mock.method(ProductVariant, 'min', async () => null as never);
    const updates = stubProduct({ id: 'p', categoryId: 'c', basePrice: 499, displayPrice: 588.82 });
    await syncProductBasePrice('p', {} as never);
    assert.deepEqual(updates, []);
  });
});

describe('product display price', () => {
  afterEach(() => mock.restoreAll());

  it("adds GST at the category's rule, at the band rate above the band", async () => {
    mock.method(taxService, 'getGstRateRule', async () => ({
      gstPercentage: 5,
      gstPriceBand: { thresholdPaise: 250_000, gstPercentageAbove: 18 },
    }));
    assert.equal(await productDisplayPrice('apparel', 2000), 2100);
    assert.equal(await productDisplayPrice('apparel', 4000), 4720);
  });

  it('computes GST in paise', () => {
    assert.equal(priceWithRuleGst({ gstPercentage: 18, gstPriceBand: null }, 476.45), 562.21);
  });

  it('resolves each category rule once', async () => {
    const lookup = mock.method(taxService, 'getGstRateRule', async () => ({ gstPercentage: 5, gstPriceBand: null }));
    const ruleFor = gstRuleResolver();
    await Promise.all([ruleFor('a'), ruleFor('a'), ruleFor('b'), ruleFor(null)]);
    assert.equal(lookup.mock.callCount(), 3);
  });
});
