import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canSeeShipmentDetails } from '../shipmentAccess';

const shipment = {
  deliveryAgentId: 'agent-carrying',
  subOrder: { vendorId: 'vendor-1', order: { userId: 'customer-1' } },
};

describe('canSeeShipmentDetails', () => {
  it('lets the customer, the vendor and the agent carrying it see it', async () => {
    assert.equal(
      await canSeeShipmentDetails({ id: 'customer-1', vendorId: null, role: { name: 'CUSTOMER' } }, shipment),
      true,
    );
    assert.equal(
      await canSeeShipmentDetails({ id: 'v-user', vendorId: 'vendor-1', role: { name: 'VENDOR_OWNER' } }, shipment),
      true,
    );
    assert.equal(
      await canSeeShipmentDetails(
        { id: 'a-user', vendorId: null, deliveryAgentId: 'agent-carrying', role: { name: 'DELIVERY_AGENT' } },
        shipment,
      ),
      true,
    );
  });

  it('refuses anonymous viewers, other customers and agents not carrying it', async () => {
    assert.equal(await canSeeShipmentDetails(null, shipment), false);
    assert.equal(
      await canSeeShipmentDetails({ id: 'customer-2', vendorId: null, role: { name: 'CUSTOMER' } }, shipment),
      false,
    );
    assert.equal(
      await canSeeShipmentDetails(
        { id: 'b-user', vendorId: null, deliveryAgentId: 'agent-other', role: { name: 'DELIVERY_AGENT' } },
        shipment,
      ),
      false,
    );
  });
});
