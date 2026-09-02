import type { PermissionKey } from '@core/permissions/permissionKeys';

export type ReportActor = {
  id: string;
  vendorId?: string | null;
  roleName: string;
  permissions: PermissionKey[];
};
