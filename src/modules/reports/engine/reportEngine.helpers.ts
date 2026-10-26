import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { PERMISSIONS, type PermissionKey } from '@core/permissions/permissionKeys';
import { DELIVERY_ROLES, ROLES, VENDOR_ROLES } from '@core/constants/statuses';
import { normalizeReportFilters } from './queryHelpers';
import type { ReportDefinition, ReportFilters } from './types';
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

/** Roles that never see platform-wide (admin-audience) reports. */
const NON_ADMIN_ROLES: readonly string[] = [...VENDOR_ROLES, ...DELIVERY_ROLES, ROLES.CUSTOMER];

/**
 * Whether the actor may see a report of this audience at all, before permission keys.
 * Admin reports are platform-wide and not vendor-scoped, and vendor roles share some
 * permission keys with admins (payout.view, product.manage…), so the keys alone would
 * hand a vendor every agent's PAN or every vendor's settlement.
 */
export function actorCanSeeAudience(
  actor: Pick<ReportActor, 'roleName' | 'vendorId'>,
  audience: ReportDefinition['audience'],
): boolean {
  if (actor.roleName === ROLES.SUPER_ADMIN) return true;
  if (!audience.startsWith('admin_')) return true;
  return !actor.vendorId && !NON_ADMIN_ROLES.includes(actor.roleName);
}

/** Audience, permission and vendor-staff gates every report run and export passes. */
export function assertActorMayRunReport(
  actor: Pick<ReportActor, 'roleName' | 'vendorId' | 'permissions'>,
  def: Pick<ReportDefinition, 'audience' | 'permissions' | 'financial'>,
): void {
  if (
    !actorCanSeeAudience(actor, def.audience) ||
    !actorCanAccess(actor.permissions, actor.roleName, def.permissions) ||
    (isVendorStaff(actor.permissions, actor.roleName) && def.financial)
  ) {
    throw new ForbiddenError(ERROR_MESSAGES.REPORT_FORBIDDEN);
  }
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
  }
  return filters;
}
