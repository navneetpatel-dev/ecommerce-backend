import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { forViewer, toShopperProduct } from '../productPublicFields';

const product = {
  id: 'p1',
  name: 'Shirt',
  basePrice: 499,
  createdBy: 'admin-1',
  updatedBy: 'admin-2',
  deletedBy: null,
  approvedById: 'admin-3',
  rejectionNote: 'blurry photo',
  listedByPlatform: true,
  vendorConsentNote: 'Agreed on call, ticket 4521',
};

describe('what shoppers never get to see on a product', () => {
  it('removes who created, changed or approved it, the moderator note and the platform-listing details', () => {
    assert.deepEqual(toShopperProduct(product), { id: 'p1', name: 'Shirt', basePrice: 499 });
  });

  it('does not change the original object', () => {
    toShopperProduct(product);
    assert.equal(product.createdBy, 'admin-1');
  });

  it('removes the commission the platform takes, from the seller and from every category', () => {
    const view = toShopperProduct({
      id: 'p1',
      vendor: { id: 'v', businessName: 'Store', commissionRate: '16.00' },
      category: { id: 'c', commissionRate: '12.50', parent: { id: 'r', commissionRate: '8.00', parent: null } },
      Category: { id: 'c', commissionRate: '12.50', createdBy: 'admin-1' },
    });
    assert.doesNotMatch(JSON.stringify(view), /commissionRate|createdBy/);
    assert.equal(view.vendor.businessName, 'Store');
  });

  it('customer-facing views are stripped; the team’s own views keep every field', () => {
    assert.equal('createdBy' in forViewer(product, true), false);
    assert.equal(forViewer(product, false), product);
    assert.equal(forViewer(product, undefined), product);
  });
});
