import { ROLES } from '@core/constants/statuses';
import type { PermissionKey } from '@core/permissions/permissionKeys';
import { ALL_REPORT_DEFINITIONS } from '../definitions';
import type { ReportDefinition } from './types';

const byType = new Map<string, ReportDefinition>(
  ALL_REPORT_DEFINITIONS.map((def) => [def.type, def]),
);

export function getReportDefinition(type: string): ReportDefinition | undefined {
  return byType.get(type);
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
