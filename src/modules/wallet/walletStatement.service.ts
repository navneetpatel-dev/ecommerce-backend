import { reportEngine, type ReportActor } from '@modules/reports/engine/reportEngine';
import type { ReportExportFormat } from '@modules/reports/engine/csvExporter';
import type { AsyncExportResult } from '@modules/reports/engine/reportEngine';
import { resolvePermissionsForUser } from '@middleware/rbac.middleware';
import { roleNameOf } from '@utils/userRole';
import type { PermissionKey } from '@core/permissions/permissionKeys';

type StatementActorUser = {
  id: string;
  roleId: string;
  vendorId?: string | null;
  role?: { name?: string } | null;
};

export async function exportWalletStatement(input: {
  actor: ReportActor;
  from: Date;
  to: Date;
  format: ReportExportFormat;
}): Promise<AsyncExportResult> {
  return reportEngine.runExport(
    input.actor,
    'customer-wallet-statement',
    {
      from: input.from,
      to: input.to,
      userId: input.actor.id,
    },
    input.format,
  );
}

export async function exportWalletStatementForUser(
  user: StatementActorUser,
  query: { from: Date; to: Date; format: ReportExportFormat },
): Promise<AsyncExportResult> {
  const roleName = user.role?.name ?? roleNameOf(user as Parameters<typeof roleNameOf>[0]);
  const permissions = (await resolvePermissionsForUser({
    roleId: user.roleId,
    role: { name: roleName },
  })) as PermissionKey[];
  return exportWalletStatement({
    actor: {
      id: user.id,
      vendorId: user.vendorId ?? null,
      roleName,
      permissions,
    },
    from: query.from,
    to: query.to,
    format: query.format,
  });
}
