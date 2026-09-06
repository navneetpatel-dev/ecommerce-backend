import { ROLES } from '@core/constants/statuses';
import type { PermissionKey } from '@core/permissions/permissionKeys';
import { ALL_REPORT_DEFINITIONS } from '../definitions';
import type { ReportAudience, ReportDefinition } from './types';

const byType = new Map<string, ReportDefinition>(
  ALL_REPORT_DEFINITIONS.map((def) => [def.type, def]),
);

export function getReportDefinition(type: string): ReportDefinition | undefined {
  return byType.get(type);
}

/** Audiences safe for the platform-wide scheduled admin digest — excludes vendor/customer
 * reports, which require a specific vendorId/userId filter the digest job doesn't have. */
const ADMIN_SCHEDULABLE_AUDIENCES: ReportAudience[] = ['admin_finance', 'admin_ops', 'admin_catalog'];

export function listSchedulableReportTypes(): { type: string; labelKey: string }[] {
  return ALL_REPORT_DEFINITIONS.filter((def) => ADMIN_SCHEDULABLE_AUDIENCES.includes(def.audience)).map(
    (def) => ({ type: def.type, labelKey: def.labelKey }),
  );
}

export function listReportDefinitionsForPermissions(
  permissions: PermissionKey[],
  roleName: string,
): ReportDefinition[] {
  if (roleName === ROLES.SUPER_ADMIN) return [...ALL_REPORT_DEFINITIONS];
  return ALL_REPORT_DEFINITIONS.filter((def) => {
    if (def.permissions.length === 0) {
      return roleName === ROLES.CUSTOMER;
    }
    return def.permissions.some((p) => permissions.includes(p));
  });
}
