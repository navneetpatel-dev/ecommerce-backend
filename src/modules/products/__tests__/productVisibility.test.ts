import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { clearPermissionCache, setPermissionCache } from '@middleware/rbac.middleware';
import { ROLE_PERMISSIONS } from '@core/permissions/permissionKeys';
import { ROLES } from '@core/constants/statuses';
import { isCatalogModerator, listsUnpublished } from '../productVisibility';

const owner = { vendorId: 'vendor-1', role: { name: 'VENDOR_OWNER' } };

describe('listsUnpublished', () => {
  it("shows a vendor every status in its own shop's listing", async () => {
    assert.equal(await listsUnpublished(owner, 'vendor-1'), true);
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

describe('who sees unpublished products is decided by permission, not by "being an admin role"', () => {
  afterEach(() => clearPermissionCache());

  const viewer = (role: string, permissions?: string[]) => {
    const roleId = `role-${role}`;
    setPermissionCache(roleId, permissions ?? [...(ROLE_PERMISSIONS[role] ?? [])]);
    return { roleId, vendorId: null, role: { name: role } };
  };

  it('the Super Admin sees them', async () => {
    assert.equal(await isCatalogModerator(viewer(ROLES.SUPER_ADMIN)), true);
    assert.equal(await listsUnpublished(viewer(ROLES.SUPER_ADMIN), undefined), true);
  });

  it('it takes product.manage or product.approve, whatever the role is called', async () => {
    assert.equal(await isCatalogModerator(viewer('CATALOG_REVIEWER', ['product.approve'])), true);
    assert.equal(await isCatalogModerator(viewer('CATALOG_LEAD', ['product.manage'])), true);
    assert.equal(await isCatalogModerator(viewer('MARKETING', ['coupon.manage', 'analytics.view'])), false);
  });

  it('vendors, customers and anonymous visitors are unchanged', async () => {
    assert.equal(await isCatalogModerator(owner), true);
    assert.equal(await isCatalogModerator(viewer(ROLES.CUSTOMER)), false);
    assert.equal(await isCatalogModerator(null), false);
    assert.equal(await isCatalogModerator(undefined), false);
  });
});
