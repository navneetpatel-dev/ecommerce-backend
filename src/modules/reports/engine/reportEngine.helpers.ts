import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { PERMISSIONS, type PermissionKey } from '@core/permissions/permissionKeys';
import { ROLES } from '@core/constants/statuses';
import { normalizeReportFilters } from './queryHelpers';
import type { ReportFilters } from './types';
import type { ReportActor } from './reportEngine.types';

export function actorCanAccess(
  permissions: PermissionKey[],
  roleName: string,
  required: PermissionKey[],
): boolean {
  if (roleName === ROLES.SUPER_ADMIN) return true;
  if (required.length === 0) return true;
  return required.some((p) => permissions.includes(p));
}

export function isVendorStaff(permissions: PermissionKey[], roleName: string): boolean {
  if (roleName === ROLES.SUPER_ADMIN || roleName === ROLES.VENDOR_OWNER) return false;
  const hasOwnerFinance = permissions.includes(PERMISSIONS.PAYOUT_VIEW);
  const hasStaffOps =
    permissions.includes(PERMISSIONS.SUBORDER_MANAGE) ||
    permissions.includes(PERMISSIONS.PRODUCT_UPDATE);
  return !hasOwnerFinance && hasStaffOps;
}

export function resolveFiltersForActor(
  actor: ReportActor,
  raw: ReportFilters,
  vendorScoped: boolean,
): ReportFilters {
  const filters = normalizeReportFilters({ ...raw });
  if (vendorScoped) {
    if (actor.roleName === ROLES.SUPER_ADMIN) {
      filters.scopedVendorId = filters.vendorId ?? null;
      return filters;
    }
    if (!actor.vendorId) {
      throw new ForbiddenError(ERROR_MESSAGES.VENDOR_NOT_LINKED);
    }
    if (raw.vendorId && raw.vendorId !== actor.vendorId) {
      throw new ForbiddenError(ERROR_MESSAGES.NOT_YOUR_VENDOR_REPORT);
    }
    filters.scopedVendorId = actor.vendorId;
    filters.vendorId = actor.vendorId;
  } else if (
    actor.roleName !== ROLES.SUPER_ADMIN &&
    !actor.permissions.includes(PERMISSIONS.COMMISSION_VIEW)
  ) {
    filters.vendorId = filters.vendorId ?? null;
  }
  return filters;
}
