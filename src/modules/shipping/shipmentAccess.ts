import { ADMIN_ROLES, ROLES } from '@core/constants/statuses';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { userHasPermission } from '@middleware/rbac.middleware';

/** Who is asking about a shipment. */
export type ShipmentViewer = {
  id: string;
  vendorId: string | null;
  deliveryAgentId?: string | null;
  role: { name: string };
};

/** The parts of a shipment its access rule reads. */
export type ShipmentAccessFacts = {
  deliveryAgentId?: string | null;
  subOrder?: { vendorId?: string | null; order?: { userId?: string } | null } | null;
};

/**
 * Who may see a shipment's details — its destination and the agent's live location: an
 * admin, the customer who ordered it, the vendor who shipped it, or the agent carrying
 * it. Not every agent, and never an anonymous viewer: the tracking number alone gets
 * only the carrier's public status.
 */
export async function canSeeShipmentDetails(
  viewer: ShipmentViewer | null,
  shipment: ShipmentAccessFacts,
): Promise<boolean> {
  if (!viewer) return false;
  if (
    (ADMIN_ROLES as readonly string[]).includes(viewer.role.name) ||
    (await userHasPermission(viewer as never, PERMISSIONS.SHIPPING_MANAGE, PERMISSIONS.ORDER_MANAGE))
  ) {
    return true;
  }
  if (viewer.role.name === ROLES.CUSTOMER && shipment.subOrder?.order?.userId === viewer.id) return true;
  if (viewer.vendorId != null && shipment.subOrder?.vendorId === viewer.vendorId) return true;
  return (
    viewer.role.name === ROLES.DELIVERY_AGENT &&
    viewer.deliveryAgentId != null &&
    shipment.deliveryAgentId === viewer.deliveryAgentId
  );
}
