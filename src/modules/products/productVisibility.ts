import { ADMIN_ROLES, ROLES } from '@core/constants/statuses';
import { PERMISSIONS } from '@core/constants/permissions';
import { userHasPermission } from '@middleware/rbac.middleware';

/** Who is asking for products. */
export type CatalogViewer = {
  roleId?: string;
  vendorId?: string | null;
  role: { name: string };
};

/** Admin/vendor dashboards stay unscoped; shoppers use customerVisible. */
export async function isCatalogModerator(viewer: CatalogViewer | null | undefined): Promise<boolean> {
  const role = viewer?.role?.name;
  if (!role) return false;
  if (role === ROLES.VENDOR_OWNER || role === ROLES.VENDOR_STAFF) return true;
  return (
    (ADMIN_ROLES as readonly string[]).includes(role) ||
    await userHasPermission(viewer, PERMISSIONS.PRODUCT_MANAGE)
  );
}

/**
 * Whether a product listing may include unpublished products. A vendor sees every status
 * only in its own shop (the dashboard asks with its vendorId); anywhere else, including
 * other shops, a vendor sees what customers see.
 */
export async function listsUnpublished(
  viewer: CatalogViewer | null | undefined,
  vendorId: string | undefined,
): Promise<boolean> {
  const role = viewer?.role?.name;
  if (role === ROLES.VENDOR_OWNER || role === ROLES.VENDOR_STAFF) {
    return Boolean(viewer?.vendorId) && vendorId === viewer?.vendorId;
  }
  return isCatalogModerator(viewer);
}
