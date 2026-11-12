import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GetProductsQuerySchema } from '../products.dto';
import { SearchProductsQuerySchema } from '../../search/search.dto';

describe('product list query rules', () => {
  it('refuses a minimum price above the maximum (B-19)', () => {
    assert.equal(GetProductsQuerySchema.safeParse({ minPrice: '500', maxPrice: '100' }).success, false);
    assert.equal(SearchProductsQuerySchema.safeParse({ q: 'shirt', minPrice: '500', maxPrice: '100' }).success, false);
  });

  it('accepts an equal or open range and refuses negative prices', () => {
    assert.equal(GetProductsQuerySchema.safeParse({ minPrice: '100', maxPrice: '100' }).success, true);
    assert.equal(GetProductsQuerySchema.safeParse({ minPrice: '100' }).success, true);
    assert.equal(GetProductsQuerySchema.safeParse({ minPrice: '-1' }).success, false);
  });

  it('reads inStock as a flag (B-23)', () => {
    assert.equal(GetProductsQuerySchema.parse({ inStock: 'true' }).inStock, true);
    assert.equal(GetProductsQuerySchema.parse({}).inStock, false);
    assert.equal(SearchProductsQuerySchema.parse({ q: 'shirt', inStock: 'false' }).inStock, false);
  });
});
