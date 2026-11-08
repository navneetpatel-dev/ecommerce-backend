import { ADMIN_ROLES, ROLES } from '@core/constants/statuses';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { userHasPermission } from '@middleware/rbac.middleware';

/** Who is asking about a shipment. */
export type ShipmentViewer = {
  id: string;
  vendorId: string | null;
  role: { name: string };
};

/** The parts of a shipment its access rule reads. */
export type ShipmentAccessFacts = {
  subOrder?: { vendorId?: string | null; order?: { userId?: string } | null } | null;
};

/**
 * Who may see a shipment's details: an admin, the customer who ordered it, or the vendor
 * who shipped it. Never an anonymous viewer: the tracking number alone gets only the
 * carrier's public status.
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
  return viewer.vendorId != null && shipment.subOrder?.vendorId === viewer.vendorId;
}
