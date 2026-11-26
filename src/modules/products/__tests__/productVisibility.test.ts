import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { clearPermissionCache, setPermissionCache } from '@middleware/rbac.middleware';
import { ROLE_PERMISSIONS } from '@core/permissions/permissionKeys';
import { ROLES } from '@core/constants/statuses';
import { isCatalogModerator, listsUnpublished } from '../productVisibility';

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

describe('who sees unpublished products is decided by permission, not by "being an admin role"', () => {
  afterEach(() => clearPermissionCache());

  const viewer = (role: string, permissions?: string[]) => {
    const roleId = `role-${role}`;
    setPermissionCache(roleId, permissions ?? [...(ROLE_PERMISSIONS[role] ?? [])]);
    return { roleId, vendorId: null, role: { name: role } };
  };

  it('Super Admin and the Catalog Manager (product.manage / product.approve) see them', async () => {
    assert.equal(await isCatalogModerator(viewer(ROLES.SUPER_ADMIN)), true);
    assert.equal(await isCatalogModerator(viewer(ROLES.ADMIN_CATALOG_MANAGER)), true);
    assert.equal(await listsUnpublished(viewer(ROLES.ADMIN_CATALOG_MANAGER), undefined), true);
  });

  it('regression: the Order Manager and the Finance Manager are admin roles but see only what shoppers see', async () => {
    for (const role of [ROLES.ADMIN_ORDER_MANAGER, ROLES.ADMIN_FINANCE_MANAGER]) {
      assert.equal(await isCatalogModerator(viewer(role)), false, role);
      assert.equal(await listsUnpublished(viewer(role), undefined), false, role);
    }
  });

  it('a custom role sees them only with product.manage or product.approve', async () => {
    assert.equal(await isCatalogModerator(viewer('CATALOG_REVIEWER', ['product.approve'])), true);
    assert.equal(await isCatalogModerator(viewer('CATALOG_LEAD', ['product.manage'])), true);
    assert.equal(await isCatalogModerator(viewer('MARKETING', ['coupon.manage', 'analytics.view'])), false);
  });

  it('vendors, customers and anonymous visitors are unchanged', async () => {
    assert.equal(await isCatalogModerator(owner), true);
    assert.equal(await isCatalogModerator(staff), true);
    assert.equal(await isCatalogModerator(viewer(ROLES.CUSTOMER)), false);
    assert.equal(await isCatalogModerator(null), false);
    assert.equal(await isCatalogModerator(undefined), false);
  });
});
