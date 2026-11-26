import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { clearPermissionCache, setPermissionCache } from '@middleware/rbac.middleware';
import { ROLE_PERMISSIONS } from '@core/permissions/permissionKeys';
import { ROLES } from '@core/constants/statuses';
import { canSeeShipmentDetails } from '../shipmentAccess';

const shipment = {
  subOrder: { vendorId: 'vendor-1', order: { userId: 'customer-1' } },
};

describe('canSeeShipmentDetails', () => {
  it('lets the customer who ordered it and the vendor who shipped it see it', async () => {
    assert.equal(
      await canSeeShipmentDetails({ id: 'customer-1', vendorId: null, role: { name: 'CUSTOMER' } }, shipment),
      true,
    );
    assert.equal(
      await canSeeShipmentDetails({ id: 'v-user', vendorId: 'vendor-1', role: { name: 'VENDOR_OWNER' } }, shipment),
      true,
    );
  });

  it('refuses anonymous viewers, other customers and other vendors', async () => {
    assert.equal(await canSeeShipmentDetails(null, shipment), false);
    assert.equal(
      await canSeeShipmentDetails({ id: 'customer-2', vendorId: null, role: { name: 'CUSTOMER' } }, shipment),
      false,
    );
    assert.equal(
      await canSeeShipmentDetails({ id: 'v2-user', vendorId: 'vendor-2', role: { name: 'VENDOR_OWNER' } }, shipment),
      false,
    );
  });
});

describe('canSeeShipmentDetails by staff permission, not by admin role', () => {
  afterEach(() => clearPermissionCache());

  const staffViewer = (role: string, permissions?: string[]) => {
    const roleId = `role-${role}`;
    setPermissionCache(roleId, permissions ?? [...(ROLE_PERMISSIONS[role] ?? [])]);
    return { id: `admin-${role}`, roleId, vendorId: null, role: { name: role } } as never;
  };

  it('Super Admin and the Order Manager (order.manage / shipping.manage) may see any shipment', async () => {
    assert.equal(await canSeeShipmentDetails(staffViewer(ROLES.SUPER_ADMIN), shipment), true);
    assert.equal(await canSeeShipmentDetails(staffViewer(ROLES.ADMIN_ORDER_MANAGER), shipment), true);
  });

  it('regression: the Catalog Manager and the Finance Manager are admin roles with no shipping job: refused', async () => {
    for (const role of [ROLES.ADMIN_CATALOG_MANAGER, ROLES.ADMIN_FINANCE_MANAGER]) {
      assert.equal(await canSeeShipmentDetails(staffViewer(role), shipment), false, role);
    }
  });

  it('a custom role is allowed with shipping.manage or order.manage and refused without', async () => {
    assert.equal(await canSeeShipmentDetails(staffViewer('LOGISTICS_LEAD', ['shipping.manage']), shipment), true);
    assert.equal(await canSeeShipmentDetails(staffViewer('FULFILMENT', ['order.manage']), shipment), true);
    assert.equal(await canSeeShipmentDetails(staffViewer('ANALYST', ['analytics.view']), shipment), false);
  });
});
