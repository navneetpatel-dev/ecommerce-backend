import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { sequelize } from '@database/models';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { categoriesService } from '@modules/categories/categories.service';
import { taxService } from '@modules/tax/tax.service';
import { productsRepository } from '../products.repository';
import { productsService } from '../products.service';

const product = {
  categoryId: '00000000-0000-4000-8000-000000000001',
  name: 'Kettle',
  description: 'Steel kettle',
  basePrice: 1000,
  secondaryCategoryIds: [],
  tags: [],
  highlights: [],
  specs: {},
};

describe('MRP includes GST', () => {
  afterEach(() => mock.restoreAll());

  function stub() {
    mock.method(sequelize, 'transaction', async (callback: (t: unknown) => Promise<unknown>) => callback({}));
    mock.method(productsRepository, 'findBySlug', async () => null);
    mock.method(categoriesService, 'assertActiveCategory', async () => undefined);
    mock.method(taxService, 'getGstRateRule', async () => ({ gstPercentage: 18, gstPriceBand: null }));
    return mock.method(productsRepository, 'create', async () => {
      throw new Error('created');
    });
  }

  it('refuses an MRP below the selling price with GST', async () => {
    const create = stub();
    // ₹1,000 + 18% GST is ₹1,180: an MRP of ₹1,100 would be undercut by the price paid.
    await assert.rejects(
      productsService.createProduct(null, { ...product, compareAtPrice: 1100 } as never),
      (error: unknown) =>
        error instanceof ValidationError && error.message === ERROR_MESSAGES.PRODUCT_COMPARE_AT_BELOW_PRICE_WITH_GST,
    );
    assert.equal(create.mock.callCount(), 0);
  });

  it('accepts an MRP at or above the selling price with GST', async () => {
    const create = stub();
    await assert.rejects(productsService.createProduct(null, { ...product, compareAtPrice: 1180 } as never), /created/);
    assert.equal(create.mock.callCount(), 1);
  });

  it("previews the customer's price for the vendor form", async () => {
    mock.method(taxService, 'getGstRateRule', async () => ({
      gstPercentage: 5,
      gstPriceBand: { thresholdPaise: 250_000, gstPercentageAbove: 18 },
    }));
    assert.deepEqual(await productsService.gstPreview(product.categoryId, 2000), { gstPercentage: 5, displayPrice: 2100 });
    assert.deepEqual(await productsService.gstPreview(product.categoryId, 3000), { gstPercentage: 18, displayPrice: 3540 });
  });
});
