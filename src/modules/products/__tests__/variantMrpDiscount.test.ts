import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import type { Product } from '@database/models/product.model';
import { Product as ProductModel } from '@database/models/product.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { mapProductResponse, syncProductBasePrice } from '../products.service';

describe('product MRP discount follows the variant', () => {
  it("gives each variant its own discount against the product's MRP", () => {
    const product = {
      get: () => ({
        id: 'product-1',
        basePrice: 1000,
        compareAtPrice: 1500,
        images: [],
        variants: [
          { id: 'v-base', price: 1000, stock: 5 },
          { id: 'v-dearer', price: 1400, stock: 5 },
          { id: 'v-above-mrp', price: 1600, stock: 5 },
        ],
      }),
    } as unknown as Product;

    const mapped = mapProductResponse(product);
    // The product's own figure stays on its base price.
    assert.equal(mapped.discountPercent, 33);
    const byId = Object.fromEntries(
      (mapped.variants as Array<{ id: string; discountPercent: number | null; showMrp: boolean }>).map(
        (variant) => [variant.id, variant],
      ),
    );
    assert.equal(byId['v-base']?.discountPercent, 33);
    // ₹1,400 against ₹1,500 is 7% off, not the product's 33%.
    assert.equal(byId['v-dearer']?.discountPercent, 7);
    assert.equal(byId['v-dearer']?.showMrp, true);
    // Priced above the MRP: no discount and no struck-through MRP.
    assert.equal(byId['v-above-mrp']?.discountPercent, null);
    assert.equal(byId['v-above-mrp']?.showMrp, false);
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

  it("sets the product's listed price to its lowest variant price", async () => {
    mock.method(ProductVariant, 'min', async () => 549 as never);
    const updates: Array<Record<string, unknown>> = [];
    mock.method(ProductModel, 'findByPk', async () => ({
      id: 'p',
      basePrice: 499,
      update: async (values: Record<string, unknown>) => {
        updates.push(values);
      },
    }) as never);
    await syncProductBasePrice('p', {} as never);
    assert.deepEqual(updates, [{ basePrice: 549 }]);
  });

  it('leaves a product without variants alone', async () => {
    mock.method(ProductVariant, 'min', async () => null as never);
    const lookup = mock.method(ProductModel, 'findByPk', async () => null as never);
    await syncProductBasePrice('p', {} as never);
    assert.equal(lookup.mock.callCount(), 0);
  });
});
