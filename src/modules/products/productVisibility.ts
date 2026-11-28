import { ROLES } from '@core/constants/statuses';
import { PERMISSIONS } from '@core/constants/permissions';
import { userHasPermission } from '@middleware/rbac.middleware';

/** Who is asking for products. */
export type CatalogViewer = {
  roleId?: string;
  vendorId?: string | null;
  role: { name: string };
};

/**
 * Whether the viewer works on a catalog at all (a vendor on its own, an admin on any). Whether
 * a particular product is theirs to see is `canSeeUnpublished`. Admins are judged by
 * permission, not by being "an admin role": the Order and Finance managers have no catalog job
 * and see only what shoppers see.
 */
export async function isCatalogModerator(viewer: CatalogViewer | null | undefined): Promise<boolean> {
  const role = viewer?.role?.name;
  if (!role) return false;
  if (role === ROLES.VENDOR_OWNER || role === ROLES.VENDOR_STAFF) return true;
  return userHasPermission(viewer, PERMISSIONS.PRODUCT_MANAGE, PERMISSIONS.PRODUCT_APPROVE);
}

/**
 * Whether the viewer gets the team's view of products belonging to `ownerVendorId`: every
 * status and the internal fields. A vendor only for its own shop; anywhere else, including
 * other shops, a vendor sees what customers see.
 */
export async function canSeeUnpublished(
  viewer: CatalogViewer | null | undefined,
  ownerVendorId: string | null | undefined,
): Promise<boolean> {
  const role = viewer?.role?.name;
  if (role === ROLES.VENDOR_OWNER || role === ROLES.VENDOR_STAFF) {
    return Boolean(viewer?.vendorId) && ownerVendorId === viewer?.vendorId;
  }
  return isCatalogModerator(viewer);
}

/** Whether a product listing (filtered to `vendorId`, if any) may include unpublished products. */
export const listsUnpublished = canSeeUnpublished;
