import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { sequelize } from '@database/models';
import { ProductImage } from '@database/models/productImage.model';
import { productsRepository } from '../products.repository';
import { productsService } from '../products.service';

describe('ProductsService.deleteProduct preserves images', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('soft-deletes the product without destroying ProductImage rows', async () => {
    mock.method(sequelize, 'transaction', async (callback: (t: unknown) => Promise<unknown>) => {
      return callback({});
    });
    mock.method(productsRepository, 'findById', async () => ({
      id: 'prod-1',
      vendorId: 'vendor-1',
    }));
    let imageDestroyCalls = 0;
    mock.method(ProductImage, 'destroy', async () => {
      imageDestroyCalls += 1;
      return 1;
    });
    let softDeleted = false;
    mock.method(productsRepository, 'softDelete', async () => {
      softDeleted = true;
      return 1;
    });

    await productsService.deleteProduct('prod-1', 'vendor-1');
    assert.equal(softDeleted, true);
    assert.equal(imageDestroyCalls, 0);
  });
});
