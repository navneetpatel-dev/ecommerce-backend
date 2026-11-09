import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { listsUnpublished } from '../productVisibility';

const owner = { vendorId: 'vendor-1', role: { name: 'VENDOR_OWNER' } };
const staff = { vendorId: 'vendor-1', role: { name: 'VENDOR_STAFF' } };

describe('listsUnpublished', () => {
  it("shows a vendor every status in its own shop's listing", async () => {
    assert.equal(await listsUnpublished(owner, 'vendor-1'), true);
    assert.equal(await listsUnpublished(staff, 'vendor-1'), true);
  });

  it('shows a vendor only published products elsewhere', async () => {
    assert.equal(await listsUnpublished(owner, undefined), false);
    assert.equal(await listsUnpublished(owner, 'vendor-2'), false);
    assert.equal(await listsUnpublished({ vendorId: null, role: { name: 'VENDOR_OWNER' } }, undefined), false);
  });

  it('keeps admins unscoped and shoppers on published products', async () => {
    assert.equal(await listsUnpublished({ role: { name: 'SUPER_ADMIN' } }, undefined), true);
    assert.equal(await listsUnpublished(null, 'vendor-1'), false);
  });
});
