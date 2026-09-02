import { Op } from 'sequelize';
import { WalletLedger } from '@database/models/walletLedger.model';
import { reportEngine, type ReportActor } from '@modules/reports/engine/reportEngine';
import type { ReportExportFormat } from '@modules/reports/engine/csvExporter';
import type { AsyncExportResult } from '@modules/reports/engine/reportEngine';
import { dateBetween } from '@modules/reports/engine/queryHelpers';
import { reportExportConfig } from '@modules/reports/reportExportConfig';
import { resolvePermissionsForUser } from '@middleware/rbac.middleware';
import { roleNameOf } from '@utils/userRole';
import type { PermissionKey } from '@core/permissions/permissionKeys';

type StatementActorUser = {
  id: string;
  roleId: string;
  vendorId?: string | null;
  role?: { name?: string } | null;
};

async function countWalletStatementRows(
  userId: string,
  from: Date,
  to: Date,
): Promise<number> {
  return WalletLedger.count({
    where: {
      userId,
      createdAt: dateBetween(from, to),
    },
  });
}

export async function exportWalletStatement(input: {
  actor: ReportActor;
  from: Date;
  to: Date;
  format: ReportExportFormat;
}): Promise<AsyncExportResult> {
  const rowCount = await countWalletStatementRows(input.actor.id, input.from, input.to);
  const processInline = rowCount <= reportExportConfig.walletStatementFastPathMaxRows;

  return reportEngine.runExport(
    input.actor,
    'customer-wallet-statement',
    {
      from: input.from,
      to: input.to,
      userId: input.actor.id,
    },
    input.format,
    processInline ? { processInline: true } : {},
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
