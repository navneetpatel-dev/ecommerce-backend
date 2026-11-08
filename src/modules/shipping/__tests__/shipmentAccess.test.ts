import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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
