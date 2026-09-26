import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Product } from '@database/models/product.model';
import { mapProductResponse } from '../products.service';

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
