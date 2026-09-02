import { reportEngine, type ReportActor } from '@modules/reports/engine/reportEngine';
import type { ReportExportFormat } from '@modules/reports/engine/csvExporter';
import { resolvePermissionsForUser } from '@middleware/rbac.middleware';
import { roleNameOf } from '@utils/userRole';
import type { PermissionKey } from '@core/permissions/permissionKeys';

type StatementActorUser = {
  id: string;
  roleId: string;
  vendorId?: string | null;
  role?: { name?: string } | null;
};

export async function exportWalletStatementDirect(
  user: StatementActorUser,
  query: { from: Date; to: Date; format: ReportExportFormat },
): Promise<{ buffer: Buffer; filename: string; contentType: string; rowCount: number }> {
  const roleName = user.role?.name ?? roleNameOf(user as Parameters<typeof roleNameOf>[0]);
  const permissions = (await resolvePermissionsForUser({
    roleId: user.roleId,
    role: { name: roleName },
  })) as PermissionKey[];
  const actor: ReportActor = {
    id: user.id,
    vendorId: user.vendorId ?? null,
    roleName,
    permissions,
  };
  return reportEngine.runExportDirect(
    actor,
    'customer-wallet-statement',
    {
      from: query.from,
      to: query.to,
      userId: actor.id,
    },
    query.format,
  );
}
