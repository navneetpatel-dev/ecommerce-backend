import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { forViewer, stripInternalProductFields } from '../productPublicFields';

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
    assert.deepEqual(stripInternalProductFields(product), { id: 'p1', name: 'Shirt', basePrice: 499 });
  });

  it('does not change the original object', () => {
    stripInternalProductFields(product);
    assert.equal(product.createdBy, 'admin-1');
  });

  it('customer-facing views are stripped; the team’s own views keep every field', () => {
    assert.equal('createdBy' in forViewer(product, true), false);
    assert.equal(forViewer(product, false), product);
    assert.equal(forViewer(product, undefined), product);
  });
});
