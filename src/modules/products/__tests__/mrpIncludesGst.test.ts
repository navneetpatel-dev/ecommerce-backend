import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { sequelize } from '@database/models';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { categoriesService } from '@modules/categories/categories.service';
import { taxService } from '@modules/tax/tax.service';
import { ProductVariant } from '@database/models/productVariant.model';
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

describe('no variant sells above the MRP', () => {
  afterEach(() => mock.restoreAll());

  function stubProduct(compareAtPrice: number | null) {
    mock.method(sequelize, 'transaction', async (callback: (t: unknown) => Promise<unknown>) => callback({}));
    mock.method(productsRepository, 'findById', async () => ({ id: 'p1', categoryId: 'c1', compareAtPrice }) as never);
    mock.method(taxService, 'getGstRateRule', async () => ({ gstPercentage: 18, gstPriceBand: null }));
  }

  it('refuses a variant whose price with GST is above the MRP', async () => {
    stubProduct(1200);
    mock.method(ProductVariant, 'findOne', async () => null);
    const create = mock.method(ProductVariant, 'create', async () => ({}) as never);
    // ₹1,100 + 18% is ₹1,298: above the ₹1,200 MRP.
    await assert.rejects(
      productsService.addVariant('p1', { sku: 'K-XL', price: 1100, stock: 5, attributes: {} } as never),
      (error: unknown) =>
        error instanceof ValidationError && error.message === ERROR_MESSAGES.PRODUCT_VARIANT_ABOVE_MRP,
    );
    assert.equal(create.mock.callCount(), 0);
  });

  it("checks the product's MRP against its dearest variant", async () => {
    mock.method(sequelize, 'transaction', async (callback: (t: unknown) => Promise<unknown>) => callback({}));
    mock.method(productsRepository, 'findById', async () =>
      ({ id: 'p1', vendorId: null, categoryId: 'c1', basePrice: 1000, compareAtPrice: 1500 }) as never,
    );
    mock.method(taxService, 'getGstRateRule', async () => ({ gstPercentage: 18, gstPriceBand: null }));
    // Variants at ₹1,000 and ₹1,200: the dearer one is ₹1,416 with GST.
    mock.method(ProductVariant, 'findAll', async () => [{ price: 1000 }, { price: 1200 }] as never);
    const update = mock.method(productsRepository, 'update', async () => [1] as never);
    await assert.rejects(
      productsService.updateProduct('p1', null, { compareAtPrice: 1400 } as never),
      (error: unknown) =>
        error instanceof ValidationError && error.message === ERROR_MESSAGES.PRODUCT_COMPARE_AT_BELOW_PRICE_WITH_GST,
    );
    assert.equal(update.mock.callCount(), 0);
  });
});
