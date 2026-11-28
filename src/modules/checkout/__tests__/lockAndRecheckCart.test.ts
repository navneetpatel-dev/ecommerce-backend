import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Product } from '@database/models/product.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { lockAndRecheckCart } from '../lockAndRecheckCart';

describe('the last check before an order is written (E11)', () => {
  afterEach(() => mock.restoreAll());

  const cart = { items: [{ id: 'line-1', variantId: 'v1', quantity: 1, variant: { product: { name: 'Mug' } } }] };
  const transaction = { LOCK: { UPDATE: 'UPDATE' } } as never;
  const product = (categoryStatus: string) => ({
    id: 'p1', name: 'Mug', status: 'LIVE', Category: { status: categoryStatus },
    vendor: { status: 'APPROVED', kycVerified: true },
  });
  const load = (categoryStatus: string) => {
    mock.method(ProductVariant, 'findAll', async () => [{ id: 'v1', productId: 'p1', stock: 5 }] as never);
    mock.method(Product, 'findAll', async () => [product(categoryStatus)] as never);
  };

  it('stops the order when the category was archived after the cart was read', async () => {
    load('ARCHIVED');
    await assert.rejects(lockAndRecheckCart(cart, transaction), (error: any) =>
      error.statusCode === 422 && error.details.items[0].unavailableReason === 'PRODUCT_UNPUBLISHED');
  });

  it('lets an on-sale cart through', async () => {
    load('ACTIVE');
    await lockAndRecheckCart(cart, transaction);
  });
});
